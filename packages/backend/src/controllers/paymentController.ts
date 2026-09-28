import { Response, Request } from "express"
import { prisma } from "../config/database"
import { env } from "../config/env"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import {
  ACTIVE_PROVIDER,
  createGatewayOrder,
  isGatewayConfigured,
  verifyGatewayPayment,
  PaymentVerificationError,
  type Provider,
  buildOrderId,
  toMinorUnits,
  verifyInboundWebhook,
} from "../services/paymentProvider"

/** Public web origin, used only to build a post-checkout return URL. */
function publicWebOrigin(): string {
  return (env.CORS_ORIGIN || "").replace(/\/+$/, "")
}

/**
 * The exact bytes of the request body, captured by the JSON parser before
 * parsing. Signature verification is impossible without these, so a missing
 * value is treated as a hard failure rather than falling back to the parsed
 * object.
 */
function rawBodyOf(req: Request): string | Buffer | undefined {
  return (req as Request & { rawBody?: Buffer }).rawBody
}

function headerValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

// ============================================================================
// PROVIDER COLUMN HELPERS
//
// The gateway is recorded per order, not read from the environment, so that
// flipping PAYMENT_PROVIDER cannot strand orders that are still in flight on
// the previous provider. These helpers keep that branching in one place.
// ============================================================================

type OrderRow = { provider?: string | null; cashfreeOrderId?: string | null; razorpayOrderId?: string | null }

function providerOf(row: OrderRow | null | undefined): Provider {
  if (row?.provider === "cashfree" || (!row?.provider && row?.cashfreeOrderId)) return "cashfree"
  return "razorpay"
}

function orderIdColumn(provider: Provider) {
  return provider === "cashfree" ? "cashfreeOrderId" : "razorpayOrderId"
}

function paymentIdColumn(provider: Provider) {
  return provider === "cashfree" ? "cashfreePaymentId" : "razorpayPaymentId"
}

/** Finds a PaymentOrder by whichever gateway actually created it. */
function findPaymentOrder(gatewayOrderId: string) {
  return prisma.paymentOrder.findFirst({
    where: { OR: [{ cashfreeOrderId: gatewayOrderId }, { razorpayOrderId: gatewayOrderId }] },
  })
}

// ============================================================================
// CREATE PAYMENT ORDER
// ============================================================================

export async function createOrder(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { amount } = req.body
    if (!amount || Number(amount) < 10) {
      sendError(res, "Amount must be at least ₹10.", 400, "INVALID_AMOUNT")
      return
    }

    const userId = req.user!.userId

    // Fail closed. There is deliberately no demo or simulated order: if the
    // gateway is unconfigured the request errors so the client can say so,
    // rather than handing back an order id that could never be paid.
    if (!isGatewayConfigured()) {
      sendError(res, "Payments are not configured on this server.", 503, "PAYMENT_NOT_CONFIGURED");
      return;
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId } })
    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND")
      return
    }

    const order = await createGatewayOrder({
      orderId: buildOrderId("topup", userId),
      amountRupees: Number(amount),
      customerId: userId,
      customerEmail: req.user!.email,
      description: "Wallet Top-Up",
      metadata: { userId, type: "TOPUP" },
      returnUrl: `${publicWebOrigin()}/wallet?payment=return`,
      currency: "INR",
    })

    // Store under the columns the active provider owns, so a later lookup
    // resolves the order through the same provider that created it.
    await prisma.paymentOrder.create({
      data: {
        ...(order.provider === "cashfree"
          ? { cashfreeOrderId: order.gatewayOrderId }
          : { razorpayOrderId: order.gatewayOrderId }),
        provider: order.provider,
        userId,
        walletId: wallet.id,
        amount: order.amountRupees,
        currency: order.currency,
        status: "CREATED",
        type: "TOPUP",
        metadata: JSON.stringify({ type: "TOPUP" }),
      },
    })

    sendSuccess(
      res,
      {
        provider: order.provider,
        orderId: order.gatewayOrderId,
        amount: order.amountRupees,
        currency: order.currency,
        // Cashfree hosts checkout and hands back a URL; Razorpay is opened
        // client-side from the order id.
        ...(order.paymentUrl ? { paymentUrl: order.paymentUrl } : {}),
      },
      "Order created."
    )
  } catch (err: any) {
    console.error("Payment order creation failed:", err)
    sendError(res, "Failed to create payment order.", 500, "PAYMENT_ORDER_FAILED")
  }
}

// ============================================================================
// VERIFY PAYMENT & CREDIT WALLET
// ============================================================================

export async function verifyPayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    // Accept both providers' field names so the client can be migrated without
    // a coordinated deploy, but the provider that matters is the one recorded
    // against the order, not the one implied by these fields.
    const gatewayOrderId =
      req.body.orderId ?? req.body.cashfreeOrderId ?? req.body.razorpayOrderId ?? req.body.razorpay_order_id
    const gatewayPaymentId =
      req.body.paymentId ?? req.body.cashfreePaymentId ?? req.body.razorpayPaymentId ?? req.body.razorpay_payment_id
    const signature = req.body.signature ?? req.body.cashfreeSignature ?? req.body.razorpaySignature ?? req.body.razorpay_signature
    const claimedAmount = req.body.amount

    const userId = req.user!.userId

    if (!isGatewayConfigured()) {
      sendError(res, "Payments are not configured on this server.", 503, "PAYMENT_NOT_CONFIGURED");
      return;
    }

    if (!gatewayOrderId) {
      sendError(res, "Missing payment verification details.", 400, "MISSING_PARAMS")
      return
    }

    const paymentOrder = await findPaymentOrder(gatewayOrderId)
    const provider = providerOf(paymentOrder)

    // Ownership is checked before any gateway call, and reported as 404 rather
    // than 403 so this cannot be used to probe which order ids exist.
    if (!paymentOrder || paymentOrder.userId !== userId) {
      sendError(res, "Payment order not found.", 404, "ORDER_NOT_FOUND")
      return
    }

    // A client-supplied amount is only ever a hint. It is compared to our own
    // record, never used to credit, so lying about it cannot change the outcome.
    if (claimedAmount !== undefined && Number(claimedAmount) !== Number(paymentOrder.amount)) {
      sendError(res, "Amount mismatch.", 400, "AMOUNT_MISMATCH")
      return
    }

    if (paymentOrder.type !== "TOPUP") {
      sendError(res, "Invalid order type.", 400, "INVALID_ORDER_TYPE")
      return
    }

    // Already credited. Answering "already verified" instead of erroring keeps
    // a retried or double-clipped callback from looking like a failure.
    if (paymentOrder.status === "COMPLETED") {
      const wallet = await prisma.wallet.findUnique({ where: { userId } })
      sendSuccess(
        res,
        {
          balance: wallet?.balance ?? null,
          paymentId: paymentOrder[paymentIdColumn(provider)],
          transactionId: null,
        },
        "Payment already verified."
      )
      return
    }

    // The single source of truth for whether money arrived. It re-reads the
    // payment from the gateway and checks status, amount and currency against
    // the values we stored. Everything below is bookkeeping.
    let verified
    try {
      verified = await verifyGatewayPayment({
        provider,
        gatewayOrderId,
        gatewayPaymentId,
        signature,
        expectedAmountRupees: Number(paymentOrder.amount),
        expectedCurrency: paymentOrder.currency,
      })
    } catch (err: any) {
      if (!(err instanceof PaymentVerificationError)) throw err

      await prisma.auditLog.create({
        data: {
          actorId: userId,
          actorType: "USER",
          action: "PAYMENT_VERIFICATION_FAILED",
          entityType: "Payment",
          entityId: String(gatewayOrderId),
          metadata: JSON.stringify({ reason: err.reason, provider }),
        },
      })

      const retryable = err.reason === "GATEWAY_UNAVAILABLE"
      sendError(
        res,
        err.message,
        retryable ? 503 : 400,
        retryable ? "PAYMENT_VERIFICATION_UNAVAILABLE" : err.reason
      )
      return
    }

    // The status latch is the idempotency guarantee. Only one caller can move
    // the order out of CREATED/AUTHORIZED, so a replayed callback or a parallel
    // request cannot credit twice.
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentOrder.updateMany({
        where: {
          [orderIdColumn(provider)]: gatewayOrderId,
          userId,
          status: { in: ["CREATED", "AUTHORIZED"] },
        },
        data: {
          status: "COMPLETED",
          [paymentIdColumn(provider)]: verified.gatewayPaymentId,
          completedAt: new Date(),
        },
      })

      if (claimed.count !== 1) return null

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: verified.amountRupees } },
      })

      const transaction = await tx.transaction.create({
        data: {
          walletId: paymentOrder.walletId,
          userId,
          type: "CREDIT",
          status: "COMPLETED",
          amount: verified.amountRupees,
          description: `Wallet top-up via ${provider}`,
          referenceId: verified.gatewayPaymentId,
        },
      })

      return { updatedWallet, transaction }
    })

    // Lost the race: another caller (webhook or parallel request) got there
    // first, so the credit already happened exactly once.
    if (!result) {
      const freshWallet = await prisma.wallet.findUnique({ where: { userId } })
      sendSuccess(
        res,
        { balance: freshWallet?.balance ?? null, paymentId: verified.gatewayPaymentId, transactionId: null },
        "Payment already verified."
      )
      return
    }

    const { updatedWallet, transaction } = result

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "PAYMENT_VERIFIED",
        entityType: "Wallet",
        entityId: paymentOrder.walletId,
        metadata: JSON.stringify({
          provider,
          gatewayPaymentId: verified.gatewayPaymentId,
          amount: verified.amountRupees,
          newBalance: updatedWallet.balance,
        }),
      },
    })

    await prisma.notification.create({
      data: {
        userId,
        title: "Payment Successful",
        body: `₹${verified.amountRupees} has been credited to your wallet.`,
        data: JSON.stringify({ paymentId: verified.gatewayPaymentId, amount: verified.amountRupees }),
      },
    })

    sendSuccess(
      res,
      {
        balance: updatedWallet.balance,
        paymentId: verified.gatewayPaymentId,
        transactionId: transaction.id,
      },
      "Payment verified and wallet credited."
    )
  } catch (err: any) {
    console.error("Payment verification error:", err)
    sendError(res, "Failed to verify payment.", 500, "PAYMENT_VERIFICATION_FAILED")
  }
}

// ============================================================================
// PAYMENT WEBHOOK (Razorpay)
// ============================================================================

export async function webhookPayment(req: Request, res: Response): Promise<void> {
  try {
    // Sign the bytes that actually arrived, not a re-serialised copy. The
    // parser in app.ts stashed them in req.rawBody before JSON.parse ran,
    // because HMAC(JSON.stringify(req.body)) can never match a body that
    // contained whitespace or a different key order.
    const rawBody = rawBodyOf(req)
    if (!rawBody) {
      res.status(400).json({ received: false, reason: "Raw body unavailable" })
      return
    }

    const signature = headerValue(req.headers["x-razorpay-signature"])
    if (!verifyInboundWebhook("razorpay", rawBody, req.headers)) {
      console.warn("Invalid Razorpay webhook signature — ignoring")
      // Acknowledge and discard. A 5xx would make Razorpay retry a payload we
      // already know is forged, so 200 with a refusal is the correct answer.
      res.status(200).json({ received: false, reason: "Invalid signature" })
      return
    }

    const event = req.body

    if (event.event === "payment.authorized") {
      // Payment authorized - record it without clobbering terminal states
      const paymentId = event.payload.payment.entity.id
      const orderId = event.payload.payment.entity.order_id

      await prisma.paymentOrder.updateMany({
        where: { razorpayOrderId: orderId, status: "CREATED" },
        data: {
          status: "AUTHORIZED",
          razorpayPaymentId: paymentId,
        },
      })
    } else if (event.event === "payment.captured") {
      // Payment captured successfully
      const paymentId = event.payload.payment.entity.id
      const orderId = event.payload.payment.entity.order_id
      const amount = Number(event.payload.payment.entity.amount) / 100

      // Status latch INSIDE the tx: only one of (webhook, client verify) can win
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.paymentOrder.updateMany({
          where: { razorpayOrderId: orderId, status: { in: ["CREATED", "AUTHORIZED"] } },
          data: {
            status: "COMPLETED",
            razorpayPaymentId: paymentId,
            completedAt: new Date(),
          },
        })

        if (claimed.count !== 1) {
          return
        }

        const paymentOrder = await tx.paymentOrder.findUnique({
          where: { razorpayOrderId: orderId },
        })

        if (!paymentOrder || Number(paymentOrder.amount) !== amount) {
          throw new Error("WEBHOOK_AMOUNT_MISMATCH")
        }

        await tx.wallet.update({
          where: { id: paymentOrder.walletId },
          data: { balance: { increment: amount } },
        })

        await tx.transaction.create({
          data: {
            walletId: paymentOrder.walletId,
            userId: paymentOrder.userId,
            type: "CREDIT",
            status: "COMPLETED",
            amount,
            description: `Wallet top-up via Razorpay webhook`,
            referenceId: paymentId,
          },
        })

        await tx.notification.create({
          data: {
            userId: paymentOrder.userId,
            title: "Payment Confirmed",
            body: `₹${amount} has been added to your wallet.`,
            data: JSON.stringify({ paymentId, amount }),
          },
        })
      }).catch((err) => {
        if (err?.message !== "WEBHOOK_AMOUNT_MISMATCH") throw err
        console.error(`Webhook captured-amount mismatch for order ${orderId}`)
      })
    } else if (event.event === "payment.failed") {
      // Payment failed
      const paymentId = event.payload.payment.entity.id
      const orderId = event.payload.payment.entity.order_id

      const paymentOrder = await prisma.paymentOrder.findUnique({
        where: { razorpayOrderId: orderId },
      })

      if (paymentOrder) {
        await prisma.$transaction([
          prisma.paymentOrder.update({
            where: { razorpayOrderId: orderId },
            data: {
              status: "FAILED",
              razorpayPaymentId: paymentId,
            },
          }),
          prisma.notification.create({
            data: {
              userId: paymentOrder.userId,
              title: "Payment Failed",
              body: `Your payment of ₹${paymentOrder.amount} failed. Please try again.`,
              data: JSON.stringify({ paymentId }),
            },
          }),
        ])
      }
    } else if (event.event === "refund.created") {
      // Refund initiated
      const paymentId = event.payload.refund.entity.payment_id
      const refundId = event.payload.refund.entity.id
      const amount = Number(event.payload.refund.entity.amount) / 100

      // Idempotency: skip if this refund was already credited
      const existing = await prisma.transaction.findFirst({
        where: { referenceId: refundId, type: "CREDIT" },
      })

      if (!existing) {
        const transaction = await prisma.transaction.findFirst({
          where: { referenceId: paymentId, type: "CREDIT", status: "COMPLETED" },
        })

        if (transaction) {
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: transaction.walletId },
              data: { balance: { increment: amount } },
            }),
            prisma.transaction.create({
              data: {
                walletId: transaction.walletId,
                userId: transaction.userId,
                type: "CREDIT",
                status: "COMPLETED",
                amount,
                description: `Refund for booking cancellation`,
                referenceId: refundId,
              },
            }),
            prisma.notification.create({
              data: {
                userId: transaction.userId,
                title: "Refund Processed",
                body: `₹${amount} refunded to your wallet.`,
                data: JSON.stringify({ refundId, amount }),
              },
            }),
          ])
        }
      }
    }

    res.json({ success: true })
  } catch (err: any) {
    console.error("Webhook error:", err)
    // Return 200 to prevent Razorpay infinite retry loop.
    // The error is logged; idempotent processing handles duplicates.
    res.status(200).json({ success: true, error: "Webhook processing failed" })
  }
}

// ============================================================================
// PAYMENT WEBHOOK (Cashfree)
// ============================================================================

/**
 * Cashfree's webhook is the only path that can settle a payment the user
 * abandoned before returning to the browser, so it carries the same weight as
 * the user-facing verify endpoint and gets the same treatment:
 *
 *  - signature checked against the raw bytes,
 *  - amount checked against our stored order, never against the payload,
 *  - a status latch so a retried delivery cannot credit twice.
 */
export async function cashfreeWebhook(req: Request, res: Response): Promise<void> {
  try {
    const rawBody = rawBodyOf(req)
    if (!rawBody) {
      res.status(400).json({ received: false, reason: "Raw body unavailable" })
      return
    }

    if (!verifyInboundWebhook("cashfree", rawBody, req.headers)) {
      console.warn("Invalid Cashfree webhook signature — ignoring")
      res.status(200).json({ received: false, reason: "Invalid signature" })
      return
    }

    const event = req.body ?? {}
    const payment = event?.data?.payment
    const orderId = payment?.order_id
    const paymentId = payment?.payment_id
    const status = String(payment?.payment_status ?? event?.type ?? "").toUpperCase()

    if (!orderId) {
      res.status(200).json({ received: true, applied: false, reason: "No order in payload" })
      return
    }

    if (status === "PAID" || status === "CAPTURED" || event?.type === "ORDER_PAID") {
      const claimed = await settleCashfreeOrder({
        gatewayOrderId: orderId,
        gatewayPaymentId: paymentId,
        // Only a hint. The authoritative comparison happens against our row
        // inside the transaction, so a tampered payload cannot raise a credit.
        payloadAmount: payment?.payment_amount,
      })
      res.status(200).json({ received: true, applied: claimed })
      return
    }

    // Abandonment and outright failure are handled differently on purpose.
    //
    // "User dropped payment" means the user walked away mid-checkout. They may
    // return and pay on the same order, so the order is left untouched and open.
    // Cashfree's USER_DROPPED status is deliberately not treated as a failure:
    // recording it as FAILED would make the settlement latch below reject the
    // eventual real payment, losing money we actually received.
    if (status === "USER_DROPPED" || event?.type === "PAYMENT_USER_DROPPED") {
      res.status(200).json({ received: true, applied: false, reason: "Payment abandoned; order left open" })
      return
    }

    if (status === "FAILED" || status === "CANCELLED" || event?.type === "PAYMENT_FAILED") {
      // Only move orders that are still open, so a late failure cannot
      // overwrite an already-settled payment.
      await prisma.paymentOrder.updateMany({
        where: { cashfreeOrderId: orderId, status: { in: ["CREATED", "AUTHORIZED"] } },
        data: { status: "FAILED", ...(paymentId ? { cashfreePaymentId: paymentId } : {}) },
      })
      res.status(200).json({ received: true, applied: true })
      return
    }

    // A dropped payment is an ABANDONMENT, not a failure. The user closed the
    // checkout and may well come back and pay, so the order is deliberately left
    // open and unsettled. Marking it FAILED here would block a later successful
    // payment on the same order and lose that money.
    //
    // Acknowledged with 200 so Cashfree stops retrying an event that is
    // informational by nature.
    res.status(200).json({ received: true, applied: false, reason: "Unhandled event" })
  } catch (err: any) {
    console.error("Cashfree webhook error:", err)
    // Deliberately NOT a 200. Cashfree retries 3 times (2/10/30 min), and that
    // retry window is the only thing that recovers a payment lost to a
    // transient fault such as a database timeout. Acknowledging an unprocessed
    // payment as delivered would tell Cashfree to stop, and the user would have
    // paid with nothing to show for it.
    //
    // A 5xx here is safe precisely because settlement is idempotent: the status
    // latch means a redelivery credits at most once.
    res.status(500).json({ received: false, error: "processing failed" })
  }
}

/**
 * Reports whether the Cashfree webhook is correctly configured.
 *
 * Exists so the provider dashboard's endpoint test has an unambiguous target:
 * a GET reachability probe is a common convention, and previously such a
 * request fell through to the API's auth handling and surfaced as a
 * connectivity failure even though the webhook itself was fine.
 *
 * This endpoint moves no money and confirms no payment. It reports whether the
 * credentials needed to verify a real signature are present and non-placeholder.
 */
export async function cashfreeWebhookHealth(_req: Request, res: Response): Promise<void> {
  const appId = (env.CASHFREE_APP_ID || "").trim()
  // The same key signs outbound API calls and inbound webhooks, so readiness
  // depends on this one value.
  const secretKey = (env.CASHFREE_SECRET_KEY || "").trim()

  const configured = (value: string) => Boolean(value) && !value.includes("placeholder")
  const ready = configured(appId) && configured(secretKey)

  res.status(200).json({
    received: true,
    // false here is expected and correct: this endpoint settles nothing.
    applied: false,
    reachable: true,
    webhookConfigured: configured(secretKey),
    activeProvider: ACTIVE_PROVIDER,
    ready,
    // Spells out what is still missing, so setup can be finished without
    // guessing from a generic failure.
      missing: [
        configured(appId) ? null : "CASHFREE_APP_ID",
        configured(secretKey) ? null : "CASHFREE_SECRET_KEY",
      ].filter(Boolean),
  })
}

/**
 * Credits a settled Cashfree order, exactly once.
 *
 * Returns true only for the caller that actually performed the credit, so a
 * duplicate delivery can be told apart from the first one.
 */
async function settleCashfreeOrder(input: {
  gatewayOrderId: string
  gatewayPaymentId?: string
  payloadAmount?: number
}): Promise<boolean> {
  const settled = await prisma.$transaction(async (tx) => {
    // Claim the order first. A conditional update is the latch: concurrent
    // deliveries both try, exactly one sees count === 1.
    const claimed = await tx.paymentOrder.updateMany({
      where: {
        cashfreeOrderId: input.gatewayOrderId,
        status: { in: ["CREATED", "AUTHORIZED"] },
      },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ...(input.gatewayPaymentId ? { cashfreePaymentId: input.gatewayPaymentId } : {}),
      },
    })

    if (claimed.count !== 1) return false

    const order = await tx.paymentOrder.findUnique({ where: { cashfreeOrderId: input.gatewayOrderId } })
    if (!order) return false

    // The payload is untrusted, so it is never compared for the credit. If the
    // gateway says a different figure than we recorded, the order is flagged
    // rather than silently trusted in either direction.
    const expectedMinor = toMinorUnits(Number(order.amount))
    const payloadMinor = input.payloadAmount === undefined ? expectedMinor : toMinorUnits(Number(input.payloadAmount))

    if (payloadMinor !== expectedMinor) {
      console.error(
        `Cashfree webhook amount mismatch for order ${input.gatewayOrderId}: ` +
          `expected ${expectedMinor} minor units, payload reported ${payloadMinor}`
      )
      throw new PaymentVerificationError("AMOUNT_MISMATCH", "Webhook amount does not match order.");
    }

    await tx.wallet.update({
      where: { id: order.walletId },
      data: { balance: { increment: Number(order.amount) } },
    })

    await tx.transaction.create({
      data: {
        walletId: order.walletId,
        userId: order.userId,
        type: "CREDIT",
        status: "COMPLETED",
        amount: Number(order.amount),
        description: "Wallet top-up via Cashfree webhook",
        referenceId: input.gatewayPaymentId ?? order.id,
      },
    })

    await tx.notification.create({
      data: {
        userId: order.userId,
        title: "Payment Confirmed",
        body: `₹${Number(order.amount)} has been added to your wallet.`,
        data: JSON.stringify({ paymentId: input.gatewayPaymentId ?? order.id, amount: Number(order.amount) }),
      },
    })

    return true
  }).catch((err) => {
    if (err instanceof PaymentVerificationError) {
      console.error(`Refusing to credit Cashfree order ${input.gatewayOrderId}: ${err.reason}`)
      return false
    }
    throw err
  })

  return settled
}

// ============================================================================
// GET PAYMENT HISTORY
// ============================================================================

// Public capability flags so clients only offer payment methods that can
// actually work (no dead auto-pay buttons when Razorpay is unconfigured).
export async function getPaymentConfig(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [upiId, upiName, upiQr] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_QR_URL" } }),
    ]);
    sendSuccess(
      res,
      {
        provider: ACTIVE_PROVIDER,
        // Reported under the historical key so existing clients keep working
        // while they move to the explicit provider key.
        razorpay: isGatewayConfigured("razorpay"),
        cashfree: isGatewayConfigured("cashfree"),
        upiManual: Boolean(upiId?.value || upiQr?.value),
        upiId: upiId?.value ?? null,
        upiAccountName: upiName?.value ?? null,
        upiQrUrl: upiQr?.value ?? null,
        cash: true,
      },
      "Payment configuration."
    );
  } catch (err: any) {
    sendError(res, "Failed to load payment configuration.", 500, "INTERNAL_ERROR");
  }
}

export async function getPaymentHistory(req: AuthedRequest, res: Response): Promise<void> {  try {
    const page = Number(req.query.page) || 1
    const limit = Number(req.query.limit) || 20

    const [items, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId: req.user!.userId },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { wallet: true },
      }),
      prisma.transaction.count({ where: { userId: req.user!.userId } }),
    ])

    sendSuccess(
      res,
      {
        items,
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
      "Payment history retrieved."
    )
  } catch (err: any) {
    console.error("Get payment history error:", err)
    sendError(res, "Failed to retrieve payment history.", 500, "INTERNAL_ERROR")
  }
}

import { Response, Request } from "express"
import QRCode from "qrcode"
import { prisma } from "../config/database"
import { env } from "../config/env"
import { publicWebOrigin } from "../config/publicOrigin"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import { applyRefund, ACCESS_DAYS, hasAccess, accessRemainingMs } from "../services/refundService"
import {
  ACTIVE_PROVIDER,
  createGatewayOrder,
  isGatewayConfigured,
  gatewayUnavailableReason,
  getPaymentMode,
  isGatewayLive,
  verifyGatewayPayment,
  PaymentVerificationError,
  type Provider,
  buildOrderId,
  toMinorUnits,
  verifyInboundWebhook,
  normalizeIndianPhone,
  sanitizeCashfreeName,
} from "../services/paymentProvider"

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
// ORDER LOOKUP
// ============================================================================

/** Cashfree owns every column now, so a stored order resolves the same way. */
function findPaymentOrder(gatewayOrderId: string) {
  return prisma.paymentOrder.findFirst({
    where: { cashfreeOrderId: gatewayOrderId },
  })
}

// ============================================================================
// CREATE PAYMENT ORDER
// ============================================================================

export async function createOrder(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { amount } = req.body
    if (!amount || Number(amount) < 10) {
      sendError(res, "Amount must be at least 10.", 400, "INVALID_AMOUNT")
      return
    }

    const userId = req.user!.userId

    // Fail closed. There is deliberately no demo or simulated order: if the
    // gateway is unconfigured the request errors so the client can say so,
    // rather than handing back an order id that could never be paid.
    //
    // Two distinct reasons, because they mean different things to whoever has to
    // act on them. "switched_off" is the deliberate manual-UPI state;
    // "not_configured" means the mode still says gateway but the credentials are
    // gone, which after the Cashfree retirement is the *normal* state of a
    // manual-UPI deployment rather than an emergency.
    //
    // Both carry the UPI details. That used to be true only for "switched_off",
    // which left a bad failure mode once the keys were deleted: the reason a user
    // hit became "not_configured", and that branch returned a bare 503 with no
    // payment route in it at all. An error the user cannot pay their way out of
    // is not a useful answer, whatever the operator log says about it. The error
    // code still distinguishes the two for monitoring.
    const unavailable = await gatewayUnavailableReason();
    if (unavailable) {
      const [upiId, upiName] = await Promise.all([
        prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
        prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      ]);
      sendError(
        res,
        unavailable === "switched_off"
          ? "Online payment is switched off. Pay using the UPI QR and submit the reference."
          : "Online payment is unavailable. Pay using the UPI QR and submit the reference.",
        503,
        unavailable === "switched_off" ? "MANUAL_UPI_ONLY" : "PAYMENT_NOT_CONFIGURED",
        undefined,
        {
          upiId: upiId?.value ?? null,
          upiAccountName: upiName?.value ?? null,
          upiQrUrl: upiId?.value ? BUILTIN_UPI_QR_PATH : null,
        }
      );
      return;
    }

    // Self-heal, matching the ten other wallet call sites in this codebase.
    // A missing wallet is a recoverable state, not a reason to refuse payment:
    // otpController creates the wallet on SMS signup but swallows failures with
    // .catch(() => {}), so one transient DB error there used to strand the user
    // permanently. They could add money in-app (walletController self-heals) and
    // then get a bare 404 "Wallet not found" when they tried to actually pay for
    // it, which reads as "this app is broken" rather than "retry".
    //
    // upsert rather than find-then-create: a user tapping "top up" twice must not
    // race two inserts into a unique-constrained userId and surface a 500.
    const wallet = await prisma.wallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    })

    // Cashfree requires customer_phone on every order. It is not on the JWT, so
    // read it from the user row and reduce it to the bare 10-digit national
    // number Cashfree documents; "+919000070900" and "0900070900" are both
    // rejected, and a bad phone is a whole-order rejection rather than a
    // downgrade to a lesser payment method.
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, fullName: true },
    })
    const customerPhone = normalizeIndianPhone(user?.phone)
    if (!customerPhone) {
      sendError(
        res,
        "Add a valid 10-digit phone number to your profile before paying. " +
          "The payment provider requires it to accept an order.",
        422,
        "PHONE_REQUIRED_FOR_PAYMENT"
      )
      return
    }

    const order = await createGatewayOrder({
      orderId: buildOrderId("topup", userId),
      amountRupees: Number(amount),
      customerId: userId,
      customerEmail: req.user!.email,
      customerPhone,
      customerName: sanitizeCashfreeName(user?.fullName),
      description: "Wallet Top-Up",
      metadata: { userId, type: "TOPUP" },
      // The {order_id} placeholder is required by Cashfree so the payer can be
      // matched to the order on the way back; without it the redirect carries
      // no order context at all.
      returnUrl: `${publicWebOrigin()}/wallet?payment=return&order_id={order_id}`,
      currency: "INR",
    })

    // Store under the columns the active provider owns, so a later lookup
    // resolves the order through the same provider that created it.
    await prisma.paymentOrder.create({
      data: {
        cashfreeOrderId: order.gatewayOrderId,
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

      // An order that cannot be paid is not a usable order. Returning 201 with
      // no checkout target left the client with a dead end that looked like
      // success, so an order with neither a checkout URL nor a session is
      // refused here rather than handed back.
      if (!order.paymentUrl && !order.sessionId) {
        console.error(
          `Cashfree order ${order.gatewayOrderId} was created with no checkout target ` +
            "(no payment_url, payment_links.web, or payment_session_id)."
        );
        sendError(
          res,
          "The payment provider accepted the order but returned no way to pay it. " +
            "No money was taken; please try again.",
          502,
          "GATEWAY_NO_CHECKOUT_TARGET"
        );
        return
      }

      sendSuccess(
        res,
        {
          provider: order.provider,
          orderId: order.gatewayOrderId,
          amount: order.amountRupees,
          currency: order.currency,
          // Cashfree hosts checkout and hands back a URL for the browser to open.
          ...(order.paymentUrl ? { paymentUrl: order.paymentUrl } : {}),
          // Current API versions hand back a session for the hosted checkout
          // SDK instead of a redirect URL.
          ...(order.sessionId ? { paymentSessionId: order.sessionId } : {}),
        },
        "Order created."
      )
    } catch (err: any) {
      console.error("Payment order creation failed:", err)
      // Every failure collapsed into one opaque 500, so neither the customer
      // nor support could tell "your phone is unusable" from "the gateway
      // rejected the order" from "the database write failed", and the only
      // place the answer existed was a log nobody could reach.
      //
      // Local validation refusals are ours and safe to state plainly. Anything
      // else is reported by category, with the upstream reason truncated and
      // passed through only as the gateway's own message: no credentials, no
      // headers, no request body.
      const reason = String(err?.message || "").trim()
      if (/requires customer_phone|loopback return_url|{order_id}|absolute URL|greater than zero|must contain the/i.test(reason)) {
        sendError(res, reason.replace(/^Error:\s*/, ""), 422, "PAYMENT_ORDER_REJECTED")
        return
      }
      if (/Cashfree .* failed \(\d+\)/.test(reason)) {
        const upstream = reason.replace(/^Error:\s*/, "").slice(0, 200)
        sendError(res, `Payment provider rejected the order: ${upstream}`, 502, "GATEWAY_REJECTED")
        return
      }
      if (/not configured|placeholder/i.test(reason)) {
        sendError(res, "Payments are not configured correctly on this server.", 503, "PAYMENT_NOT_CONFIGURED")
        return
      }
      sendError(res, "Failed to create payment order.", 500, "PAYMENT_ORDER_FAILED")
    }
}

// ============================================================================
// VERIFY PAYMENT & CREDIT WALLET
// ============================================================================

export async function verifyPayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    // Accept the generic and Cashfree field names so an older client build can
    // still be upgraded without a coordinated deploy.
    const gatewayOrderId = req.body.orderId ?? req.body.cashfreeOrderId
    const gatewayPaymentId = req.body.paymentId ?? req.body.cashfreePaymentId
    const signature = req.body.signature ?? req.body.cashfreeSignature
    const claimedAmount = req.body.amount

    const userId = req.user!.userId

    // Credentials only, deliberately ignoring the payment mode switch.
    //
    // Verification reads a payment that may already have been taken and credits
    // it; it never creates a charge. So switching to manual UPI must not stop it:
    // an order created a minute before the switch can still have been paid
    // through the gateway, and refusing to verify would strand that money with
    // no way for the user to recover it. Gating this on the mode would be
    // tidier-looking and strictly worse.
    if (!isGatewayConfigured()) {
      sendError(res, "Payments are not configured on this server.", 503, "PAYMENT_NOT_CONFIGURED");
      return;
    }

    if (!gatewayOrderId) {
      sendError(res, "Missing payment verification details.", 400, "MISSING_PARAMS")
      return
    }

    const paymentOrder = await findPaymentOrder(gatewayOrderId)
    const provider = ACTIVE_PROVIDER

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
          paymentId: paymentOrder.cashfreePaymentId,
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
          cashfreeOrderId: gatewayOrderId,
          userId,
          // FAILED is claimable because Cashfree can fail one attempt and then
          // succeed on a later one for the same order, and the money really is
          // ours. COMPLETED stays excluded, which is what prevents a double credit.
          status: { in: ["CREATED", "AUTHORIZED", "FAILED"] },
        },
        data: {
          status: "COMPLETED",
          cashfreePaymentId: verified.gatewayPaymentId,
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
        // A rejected webhook means this order was NOT credited, and Cashfree
        // will not retry a 2xx. A customer who closes the tab after paying never
        // gets a wallet credit, so this must be visible rather than a quiet warn:
        // either a genuine provider retry, or a signature mismatch that would
        // otherwise silently swallow every payment. Check the order id below.
        const rejectedOrderId =
          (req.body as any)?.data?.order?.order_id ??
          (req.body as any)?.data?.payment?.order_id ??
          "unknown"
        console.error(
          `[cashfree-webhook] SIGNATURE REJECTED - order ${rejectedOrderId} was NOT credited. ` +
            "If no matching wallet credit exists, this order needs manual reconciliation. " +
            "Check that CASHFREE_SECRET_KEY is the oldest active key pair and that " +
            "CASHFREE_API_ENV matches the configured keys."
        )
        res.status(200).json({ received: false, reason: "Invalid signature" })
        return
      }

    const event = req.body ?? {}
    const payment = event?.data?.payment
    const refund = event?.data?.refund
    const orderId = payment?.order_id ?? refund?.order_id
    const paymentId = payment?.payment_id ?? refund?.payment_id
    const status = String(payment?.payment_status ?? event?.type ?? "").toUpperCase()

    // Refunds are matched BEFORE the order-id guard below. A refund payload
    // carries data.refund rather than data.payment, so requiring an order first
    // rejected every real refund with "No order in payload" and never reached
    // the handler. applyRefund resolves the order itself from paymentId, so it
    // does not need an order id from the payload.
    const refundId = refund?.refund_id
    const refundStatus = String(refund?.status ?? "").toUpperCase()
    const refundAmount = refund?.refund_amount
    const isRefundEvent =
      event?.type === "REFUNDS" || event?.type === "REFUND" || event?.type === "AUTO_REFUND"

    if (isRefundEvent) {
      const outcome = await applyRefund({
        gatewayRefundId: refundId,
        gatewayPaymentId: paymentId,
        payloadAmount: refundAmount,
      })
      if (outcome.applied) {
        console.log(
          `[cashfree-webhook] REFUND APPLIED ${outcome.refundId} amount=${outcome.amount} accessRevoked=${outcome.accessRevoked}`,
        )
      } else {
        // Logged loudly rather than swallowed: a refund that did not apply is
        // money we hold but the user does not, which needs reconciliation.
        console.warn(`[cashfree-webhook] refund not applied: ${outcome.reason}`)
      }
      res.status(200).json({
        received: true,
        applied: outcome.applied,
        refundStatus,
        reason: outcome.applied ? undefined : outcome.reason,
      })
      return
    }

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
/**
 * Days of access a settled top-up grants.
 *
 * Read from env so the window is an operational decision rather than a code
 * change, with the seed default of 30 days. A malformed or absent value falls
 * back to 30 rather than granting zero access or an unbounded window.
 */
function readAccessDays(): number {
  // env.ACCESS_WINDOW_DAYS is declared in config/env and validated on boot, so
  // it is already a positive integer within range. ACCESS_DAYS stays as the
  // floor in case the value is absent outside a validated boot.
  const raw = Number(env.ACCESS_WINDOW_DAYS)
  if (!Number.isFinite(raw) || raw <= 0) return ACCESS_DAYS
  return Math.min(Math.floor(raw), 3650)
}

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
        // FAILED is claimable on purpose. Cashfree can report a failure for one
        // attempt and then a success for a later attempt on the same order, and
        // the money really is ours in that case. Refusing a success because an
        // earlier attempt failed would take a genuine payment and drop it.
        // COMPLETED is excluded, which is what actually prevents a double credit.
        status: { in: ["CREATED", "AUTHORIZED", "FAILED"] },
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

    // Grant the local access window in the same transaction as the credit, so
    // access can never exist without the payment that paid for it, and a
    // redelivery cannot extend it twice (only the claiming delivery reaches
    // here). Extended from the current expiry rather than from now, so paying
    // early does not waste paid days.
    //
    // This is what makes paid users get access at all while Cashfree
    // Subscriptions is unavailable: hasActiveSubscription() can only ever see
    // an ACTIVE row, and only the gateway creates those.
    const accessDays = readAccessDays();
    const buyer = await tx.user.findUnique({
      where: { id: order.userId },
      select: { accessUntil: true },
    })
    if (buyer) {
      const now = new Date()
      const base = buyer.accessUntil && buyer.accessUntil > now ? buyer.accessUntil : now
      const accessUntil = new Date(base.getTime() + accessDays * 24 * 60 * 60 * 1000)
      await tx.user.update({
        where: { id: order.userId },
        data: { accessUntil, accessSource: "TOPUP" },
      })
    }

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

/** Built-in QR image, used when UPI_QR_URL has not been configured. */
export const BUILTIN_UPI_QR_PATH = "/api/payments/upi-qr.png";

/**
 * Renders the platform UPI QR as a PNG from the configured UPI_ID.
 *
 * The manual top-up page already renders whatever UPI_QR_URL contains, and the
 * web client resolves a root-relative path against the API host, so serving
 * this here means scan-to-pay works with no frontend change and no third-party
 * image host. Returns 404 when no UPI ID is configured, so a client never shows
 * a QR that encodes nothing.
 */
export async function getUpiQrImage(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [upiId, upiName] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
    ]);
    const payeeVpa = String(upiId?.value || "").trim();
    if (!payeeVpa || !payeeVpa.includes("@")) {
      res.status(404).json({ success: false, message: "No UPI ID configured.", error: "NOT_CONFIGURED" });
      return;
    }

    const params = new URLSearchParams({
      pa: payeeVpa,
      pn: String(upiName?.value || "Nabri").trim() || "Nabri",
      cu: "INR",
    });
    const amount = Number(req.query.amount);
    if (Number.isFinite(amount) && amount > 0) {
      params.set("am", amount.toFixed(2));
    }
    const note = String(req.query.note || "").trim();
    if (note) params.set("tn", note.slice(0, 50));

    const png = await QRCode.toBuffer(`upi://pay?${params.toString()}`, {
      type: "png",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 512,
      color: { dark: "#000000ff", light: "#ffffffff" },
    });

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(png);
  } catch (err: any) {
    console.error("getUpiQrImage error:", err);
    sendError(res, "Failed to generate UPI QR code.", 500, "INTERNAL_ERROR");
  }
}

// Public capability flags so clients only offer payment methods that can
// actually work, rather than a button that fails at checkout.
export async function getPaymentConfig(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const [upiId, upiName, upiQr, mode, gatewayLive] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_QR_URL" } }),
      getPaymentMode(),
      isGatewayLive(),
    ]);
    // Manual UPI is only offered when there is something to scan. Advertising
    // it with no VPA configured produces a QR-less payment screen the user
    // cannot complete, which is worse than not offering the rail at all.
    const upiAvailable = Boolean(upiId?.value || upiQr?.value);
    sendSuccess(
      res,
      {
        provider: ACTIVE_PROVIDER,
        mode,
        // The rail the client should actually use. Deliberately a single value
        // rather than two independent booleans: with both false there is nothing
        // a client can do, and "which one wins" was previously left to each
        // client to guess.
        activeMethod: gatewayLive ? "gateway" : upiAvailable ? "manual_upi" : "none",
        // Also reported under the historical key so clients built before the
        // switch keep working until they are updated.
        cashfree: gatewayLive,
        gatewayEnabled: gatewayLive,
        upiManual: upiAvailable,
        upiId: upiId?.value ?? null,
        upiAccountName: upiName?.value ?? null,
        // Fall back to the QR rendered by this service when no image has been
        // configured, so scan-to-pay is available out of the box rather than
        // degrading to a copy-paste VPA.
        upiQrUrl: upiQr?.value || (upiId?.value ? BUILTIN_UPI_QR_PATH : null),
        cash: true,
      },
      "Payment configuration."
    );
  } catch (err: any) {
    sendError(res, "Failed to load payment configuration.", 500, "INTERNAL_ERROR");
  }
}

/**
 * GET /payments/access
 *
 * The single source of truth for "does this user have paid access, and until
 * when". Deliberately reads the local accessUntil timestamp rather than counting
 * ACTIVE Subscription rows: that check can only be satisfied by a Cashfree
 * subscription webhook, which cannot be registered while Subscriptions is
 * inactive, so it would report false for every paying user.
 *
 * Clients should gate on this rather than inferring access from a plan list.
 */
export async function getMyAccess(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      sendError(res, "Unauthorized.", 401, "UNAUTHORIZED");
      return;
    }

    const [active, remainingMs, user] = await Promise.all([
      hasAccess(userId),
      accessRemainingMs(userId),
      prisma.user.findUnique({
        where: { id: userId },
        select: { accessUntil: true, accessSource: true },
      }),
    ]);

    const refundPolicy =
      "A settled payment grants access for the configured window. A full refund " +
      "revokes access and reverses the wallet credit that payment created.";

    // Admins are entitled by role with no window, so Infinity must not be
    // rendered as an absurd day count.
    const isAdminBypass = active && !Number.isFinite(remainingMs ?? 0);

    sendSuccess(res, {
      hasAccess: active,
      accessUntil: isAdminBypass ? null : user?.accessUntil ?? null,
      accessSource: isAdminBypass ? "ADMIN" : user?.accessSource ?? null,
      daysRemaining: isAdminBypass
        ? null
        : remainingMs === null
          ? 0
          : Math.ceil(remainingMs / (24 * 60 * 60 * 1000)),
      accessWindowDays: readAccessDays(),
      refundPolicy,
    });
  } catch {
    sendError(res, "Could not load access status.", 500, "ACCESS_FETCH_FAILED");
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

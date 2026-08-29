import { Response, Request } from "express"
import { prisma } from "../config/database"
import { env } from "../config/env"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import * as razorpayService from "../services/razorpayService"

// ============================================================================
// CREATE RAZORPAY ORDER
// ============================================================================

export async function createOrder(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { amount } = req.body
    if (!amount || amount < 10) {
      sendError(res, "Amount must be at least ₹10.", 400, "INVALID_AMOUNT")
      return
    }

    const userId = req.user!.userId

    if (env.RAZORPAY_KEY_ID.includes("placeholder")) {
      sendError(res, "Payments are not configured on this server.", 503, "PAYMENT_NOT_CONFIGURED");
      return;
    }

    // Real Razorpay order only — no demo/test fallback. If the gateway is
    // unreachable the request fails with a real error so the client can surface
    // it honestly to the user.
    const order = await razorpayService.createOrder(
      amount,
      "INR",
      `topup_${userId}_${Date.now()}`,
      "Wallet Top-Up",
      { userId, type: "TOPUP" }
    )

    // Create record in database
    const wallet = await prisma.wallet.findUnique({ where: { userId } })
    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND")
      return
    }

    await prisma.paymentOrder.create({
      data: {
        razorpayOrderId: order.id,
        userId,
        walletId: wallet.id,
        amount,
        currency: "INR",
        status: "CREATED",
        type: "TOPUP",
        metadata: JSON.stringify({ type: "TOPUP" }),
      },
    })

    sendSuccess(
      res,
      {
        orderId: order.id,
        amount: Number(order.amount) / 100,
        currency: order.currency,
      },
      "Order created."
    )
  } catch (err: any) {
    console.error("Razorpay order creation failed:", err)
    sendError(res, "Failed to create payment order.", 500, "PAYMENT_ORDER_FAILED")
  }
}

// ============================================================================
// VERIFY PAYMENT & CREDIT WALLET
// ============================================================================

export async function verifyPayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, amount } = req.body

    const userId = req.user!.userId

    if (env.RAZORPAY_KEY_ID.includes("placeholder")) {
      sendError(res, "Payments are not configured on this server.", 503, "PAYMENT_NOT_CONFIGURED");
      return;
    }

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      sendError(res, "Missing payment verification details.", 400, "MISSING_PARAMS")
      return
    }

    // Verify the Razorpay signature (cryptographic proof the payment is genuine).
    const isValid = razorpayService.verifyPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature)
    if (!isValid) {
      await prisma.auditLog.create({
        data: {
          actorId: userId,
          actorType: "USER",
          action: "PAYMENT_VERIFICATION_FAILED",
          entityType: "Payment",
          entityId: razorpayPaymentId,
          metadata: JSON.stringify({ reason: "Invalid signature" }),
        },
      })
      sendError(res, "Payment verification failed.", 400, "INVALID_SIGNATURE")
      return
    }

    // Fetch payment details from Razorpay to verify amount/capture status.
    // The HMAC above is already cryptographic proof the payment is genuine;
    // if the details API hiccups, fall back to the signed order data rather
    // than failing a legitimate payment.
    let paymentDetails: { status: string; amount: number | string } | null = null
    try {
      paymentDetails = await razorpayService.fetchPayment(razorpayPaymentId)
      if (!paymentDetails || paymentDetails.status !== "captured") {
        sendError(res, "Payment not captured.", 400, "PAYMENT_NOT_CAPTURED")
        return
      }
    } catch {
      paymentDetails = null // trust signature + stored order amount below
    }

    // Find wallet
    const wallet = await prisma.wallet.findUnique({ where: { userId } })
    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND")
      return
    }

    const paymentOrder = await prisma.paymentOrder.findUnique({
      where: { razorpayOrderId },
    })

    if (!paymentOrder || paymentOrder.userId !== userId) {
      sendError(res, "Payment order not found.", 404, "ORDER_NOT_FOUND")
      return
    }

    if (amount !== undefined && Number(amount) !== Number(paymentOrder.amount)) {
      sendError(res, "Amount mismatch.", 400, "AMOUNT_MISMATCH")
      return
    }

    if (paymentDetails && Number(paymentDetails.amount) / 100 !== Number(paymentOrder.amount)) {
      sendError(res, "Captured amount does not match order.", 400, "AMOUNT_MISMATCH")
      return
    }

    // When Razorpay details are unavailable, the signed PaymentOrder amount is authoritative.
    const amountInRupees = paymentDetails ? Number(paymentDetails.amount) / 100 : Number(paymentOrder.amount)

    if (paymentOrder.type !== "TOPUP") {
      sendError(res, "Invalid order type.", 400, "INVALID_ORDER_TYPE")
      return
    }

    if (paymentOrder.status === "COMPLETED") {
      // Idempotent replay: order already credited — do NOT credit again
      sendSuccess(
        res,
        { balance: wallet.balance, paymentId: razorpayPaymentId, transactionId: null },
        "Payment already verified."
      )
      return
    }

    // Update in transaction — the status latch makes concurrent/replay calls safe:
    // only ONE caller can flip CREATED/AUTHORIZED -> COMPLETED and win the credit.
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.paymentOrder.updateMany({
        where: { razorpayOrderId, userId, status: { in: ["CREATED", "AUTHORIZED"] } },
        data: {
          status: "COMPLETED",
          razorpayPaymentId,
          completedAt: new Date(),
        },
      })

      if (claimed.count !== 1) {
        return null
      }

      const updatedWallet = await tx.wallet.update({
        where: { userId },
        data: { balance: { increment: amountInRupees } },
      })

      const transaction = await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId,
          type: "CREDIT",
          status: "COMPLETED",
          amount: amountInRupees,
          description: `Wallet top-up via Razorpay`,
          referenceId: razorpayPaymentId,
        },
      })

      return { updatedWallet, transaction }
    })

    if (!result) {
      // Lost the race (webhook or parallel call already completed this order)
      const freshWallet = await prisma.wallet.findUnique({ where: { userId } })
      sendSuccess(
        res,
        { balance: freshWallet?.balance ?? wallet.balance, paymentId: razorpayPaymentId, transactionId: null },
        "Payment already verified."
      )
      return
    }

    const { updatedWallet, transaction } = result

    // Log action
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "PAYMENT_VERIFIED",
        entityType: "Wallet",
        entityId: wallet.id,
        metadata: JSON.stringify({
          razorpayPaymentId,
          amount: amountInRupees,
          newBalance: updatedWallet.balance,
        }),
      },
    })

    // Send notification
    await prisma.notification.create({
      data: {
        userId,
        title: "Payment Successful",
        body: `₹${amountInRupees} has been credited to your wallet.`,
        data: JSON.stringify({ paymentId: razorpayPaymentId, amount: amountInRupees }),
      },
    })

    sendSuccess(
      res,
      {
        balance: updatedWallet.balance,
        paymentId: razorpayPaymentId,
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
    const signature = req.headers["x-razorpay-signature"] as string
    const payload = JSON.stringify(req.body)

    // Verify webhook signature
    const isValid = razorpayService.verifyWebhookSignature(payload, signature)
    if (!isValid) {
      console.warn("Invalid webhook signature — ignoring")
      // Return 200 to prevent infinite Razorpay retry loops.
      // The payload is not genuine, so we safely acknowledge and discard.
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
    res.status(500).json({ error: "Webhook processing failed" })
  }
}

// ============================================================================
// GET PAYMENT HISTORY
// ============================================================================

export async function getPaymentHistory(req: AuthedRequest, res: Response): Promise<void> {
  try {
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

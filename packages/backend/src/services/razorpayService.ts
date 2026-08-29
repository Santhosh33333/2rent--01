import Razorpay from "razorpay"
import crypto from "crypto"
import { env } from "../config/env"

let razorpayInstance: Razorpay | null = null

function getRazorpay(): Razorpay {
  if (!razorpayInstance) {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new Error("Razorpay credentials are not configured")
    }
    razorpayInstance = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    })
  }
  return razorpayInstance
}

export async function createOrder(
  amount: number,
  currency: string = "INR",
  receipt: string,
  description?: string,
  notes?: Record<string, any>
) {
  const razorpay = getRazorpay()

  if (amount <= 0) {
    throw new Error(`Order amount must be greater than zero (got ${amount})`)
  }

  // Razorpay rejects receipts longer than 40 chars; keep it short and unique.
  const safeReceipt = `${Buffer.from(receipt).toString("base64url").slice(0, 12)}_${Date.now().toString(36)}`

  const orderPromise = razorpay.orders.create({
    amount: Math.round(amount * 100),
    currency,
    receipt: safeReceipt,
    notes: {
      ...(notes ?? {}),
      ...(receipt ? { originalReceipt: receipt.slice(0, 200) } : {}),
      ...(description ? { description } : {}),
    },
  })

  // Fail fast instead of hanging when the Razorpay API is slow/unreachable.
  // Keeps wallet top-up usable instead of timing out the whole request.
  const order = await withTimeout(orderPromise, 12000)
  return order
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Razorpay request timed out")), ms)
    p.then(
      (res) => {
        clearTimeout(t)
        resolve(res)
      },
      (err) => {
        clearTimeout(t)
        reject(err)
      }
    )
  })
}

export function verifyPayment(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): boolean {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay key secret is not configured")
  }
  const body = razorpayOrderId + "|" + razorpayPaymentId
  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest("hex")
  return expectedSignature === razorpaySignature
}

export function verifyWebhookSignature(
  payload: string,
  signature: string
): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error("Razorpay webhook secret is not configured")
  }
  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex")
  return expectedSignature === signature
}

export async function fetchPayment(paymentId: string) {
  const razorpay = getRazorpay()
  return await razorpay.payments.fetch(paymentId)
}

export async function fetchOrder(orderId: string) {
  const razorpay = getRazorpay()
  return await razorpay.orders.fetch(orderId)
}

export async function refund(paymentId: string, amount?: number, notes?: Record<string, any>) {
  const razorpay = getRazorpay()
  return await razorpay.payments.refund(paymentId, {
    amount: amount ? amount * 100 : undefined, // Amount in paise
    notes: notes || {},
  })
}

export async function getPaymentDetails(paymentId: string) {
  const razorpay = getRazorpay()
  return await razorpay.payments.fetch(paymentId)
}

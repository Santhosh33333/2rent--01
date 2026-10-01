import { Router } from "express"
import { body } from "express-validator"
import { authenticateToken } from "../middleware/auth"
import { sanitizeInput, validateRequest } from "../middleware/validation"
import * as paymentController from "../controllers/paymentController"
import { lookupUpiPayee } from "../controllers/upiLookupController"

const router = Router()

// Webhooks - no authentication. Authenticity comes from the signature over the
// raw body, which is checked inside the handler. The path is explicit so an
// unauthenticated request never has to be routed by guessing.
router.post("/webhook/cashfree", paymentController.cashfreeWebhook)

// Reachability probe for the provider dashboard's "test endpoint" button.
//
// A GET is unauthenticated by design, like the POST routes, and deliberately
// reports configuration only. It accepts no event, moves no money, and cannot
// be used to confirm a payment: a caller must supply a real signature on the
// POST route for anything to be settled.
router.get("/webhook/cashfree", paymentController.cashfreeWebhookHealth)

// Authenticated routes
router.use(authenticateToken)

// Resolve a UPI ID (or phone number) to the payee's account holder name.
router.post(
  "/lookup-upi",
  [body("query").isString().isLength({ min: 2, max: 100 }).withMessage("Enter a UPI ID or phone number")],
  sanitizeInput,
  validateRequest,
  lookupUpiPayee
)

router.post(
  "/create-order",
  [body("amount").isFloat({ min: 10 }).withMessage("Amount must be at least ₹10")],
  sanitizeInput,
  validateRequest,
  paymentController.createOrder
)

// Accept the generic and Cashfree field names so web and mobile clients can move
// over independently. Only the order id is structurally required; the payment id
// and signature are checked by the controller.
router.post(
  "/verify",
  [
    body().custom((value: Record<string, unknown>) => {
      const orderId = value?.orderId ?? value?.cashfreeOrderId
      if (typeof orderId !== "string" || !orderId.trim()) {
        throw new Error("An order ID is required")
      }
      return true
    }),
  ],
  sanitizeInput,
  validateRequest,
  paymentController.verifyPayment
)

router.get("/history", paymentController.getPaymentHistory)
  router.get("/config", paymentController.getPaymentConfig)

  // Single source of truth for paid access and the day count remaining. Clients
  // gate on this instead of inferring access from a plan list.
  router.get("/access", paymentController.getMyAccess)

  // QR for the configured platform UPI ID, rendered server-side. The top-up
  // page loads it as an <img>, so it is read-only and needs no JSON envelope;
  // a browser cannot send an Authorization header on an image request, and
  // requiring one would leave the QR broken in the one place it is needed.
  router.get("/upi-qr.png", paymentController.getUpiQrImage)

export default router

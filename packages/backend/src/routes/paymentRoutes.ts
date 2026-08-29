import { Router } from "express"
import { body } from "express-validator"
import { authenticateToken } from "../middleware/auth"
import { sanitizeInput, validateRequest } from "../middleware/validation"
import * as paymentController from "../controllers/paymentController"

const router = Router()

// Webhook - No authentication required
router.post("/webhook", paymentController.webhookPayment)

// Authenticated routes
router.use(authenticateToken)

router.post(
  "/create-order",
  [body("amount").isFloat({ min: 10 }).withMessage("Amount must be at least ₹10")],
  sanitizeInput,
  validateRequest,
  paymentController.createOrder
)

router.post(
  "/verify",
  [
    body("razorpayOrderId").notEmpty().withMessage("Razorpay order ID is required"),
    body("razorpayPaymentId").notEmpty().withMessage("Razorpay payment ID is required"),
    body("razorpaySignature").notEmpty().withMessage("Razorpay signature is required"),
    body("amount").isFloat({ min: 10 }).withMessage("Amount is required"),
  ],
  sanitizeInput,
  validateRequest,
  paymentController.verifyPayment
)

router.get("/history", paymentController.getPaymentHistory)

export default router

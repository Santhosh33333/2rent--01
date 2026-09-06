import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { preventDuplicateBooking, preventDuplicatePayment } from "../middleware/fraudPrevention";
import * as bookingController from "../controllers/bookingController";
import { SERVICE_KEYS } from "../services/serviceCatalog";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Create booking
router.post(
  "/",
  [
    body("serviceType").custom((value) => {
      if (Array.isArray(value)) {
        return value.length > 0 && value.every((item) => SERVICE_KEYS.includes(item));
      }
      return typeof value === "string" && SERVICE_KEYS.includes(value);
    }),
    body("startLocation").notEmpty().trim().isLength({ min: 2, max: 200 }),
    body("endLocation").notEmpty().trim().isLength({ min: 2, max: 200 }),
    body("scheduledAt").notEmpty().isISO8601(),
    body("durationMinutes").optional().isInt({ min: 1, max: 480 }),
    body("itemType").optional().isString().trim(),
    body("itemDescription").optional().isString().trim().isLength({ max: 500 }),
    body("notes").optional().isString().trim().isLength({ max: 500 }),
    body("sameGenderOnly").optional().isBoolean().toBoolean(),
  ],
  sanitizeInput,
  validateRequest,
  preventDuplicateBooking,
  bookingController.createBooking
);

// Get price estimate
router.get("/price-estimate", bookingController.getPriceEstimate);

// Get my bookings
router.get("/", bookingController.getMyBookings);

// Get booking detail
router.get("/:id", bookingController.getBookingDetail);

// Initiate payment
router.post("/:id/pay", bookingController.initiatePayment);

// Verify payment
router.post("/:id/verify-payment", preventDuplicatePayment, bookingController.verifyPayment);

// Manual UPI / QR payment (temporary flow for personal UPI accounts)
router.get("/:id/upi-details", bookingController.getUpiDetails);
router.post("/:id/upi-reference", bookingController.submitUpiReference);

// Accept booking (partner)
router.post("/:id/accept", bookingController.acceptBooking);

// Reject booking (partner)
router.post(
  "/:id/reject",
  [body("reason").optional().isString().trim().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  bookingController.rejectBooking
);

// Start booking (partner) — requires verified START OTP (see controller).
router.post("/:id/start", bookingController.startBooking);

// Controlled job workflow (spec 84-100): OTP-gated, backend-verified.
// Start code is issued to the USER only; the partner enters it.
router.post("/:id/start-otp", bookingController.getStartOtp);
router.post(
  "/:id/start-verify",
  [body("startOtp").notEmpty().trim().isLength({ min: 4, max: 10 })],
  sanitizeInput,
  validateRequest,
  bookingController.verifyStartOtpHandler
);

// Travel: GO TO JOB / ARRIVED (partner, time-window gated).
router.post("/:id/go", bookingController.goToJob);
router.post("/:id/arrived", bookingController.markArrivedHandler);

// Completion: partner requests, user issues code, partner completes with code.
router.post("/:id/request-completion", bookingController.requestCompletionHandler);
router.post("/:id/completion-otp", bookingController.getCompletionOtp);

// Complete booking (partner) — requires COMPLETION OTP (see controller).
router.post(
  "/:id/complete",
  [
    body("endLatitude").optional().isFloat({ min: -90, max: 90 }),
    body("endLongitude").optional().isFloat({ min: -180, max: 180 }),
    body("completionOtp").optional().isString().trim().isLength({ min: 4, max: 10 }),
    body("waitingMinutes").optional().isInt({ min: 0, max: 480 }),
  ],
  sanitizeInput,
  validateRequest,
  bookingController.completeBooking
);

// Cancel booking
router.post(
  "/:id/cancel",
  [body("reason").optional().isString().trim().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  bookingController.cancelBookingHandler
);

// Rate booking
router.post(
  "/:id/rate",
  [
    body("score").notEmpty().isInt({ min: 1, max: 5 }),
    body("comment").optional().isString().trim().isLength({ max: 500 }),
  ],
  sanitizeInput,
  validateRequest,
  bookingController.rateBooking
);

// Rate customer (partner)
router.post(
  "/:id/rate-user",
  [
    body("score").notEmpty().isInt({ min: 1, max: 5 }),
    body("comment").optional().isString().trim().isLength({ max: 500 }),
  ],
  sanitizeInput,
  validateRequest,
  bookingController.rateUserByPartner
);

// Booking receipt
router.get("/:id/receipt", bookingController.getBookingReceipt);

// Live tracking snapshot (phase + real GPS + ETA estimate)
router.get("/:id/tracking", bookingController.getBookingTracking);

// Select payment method (after partner accepts)
router.post(
  '/:id/select-payment-method',
  [body('paymentMethod').notEmpty().isIn(['ONLINE', 'CASH', 'UPI_MANUAL'])],
  sanitizeInput,
  validateRequest,
  bookingController.selectPaymentMethod
);

// Partner confirms cash received
router.post('/:id/confirm-cash', bookingController.confirmCashReceived);

export default router;


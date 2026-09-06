import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import * as partnerController from "../controllers/partnerController";
import * as bookingController from "../controllers/bookingController";

const router = Router();
router.use(authenticateToken);

// Becoming a partner requires the applicant's own KYC to be admin-approved first.
router.post(
  "/apply",
  requireKycVerified,
  [body("providesWalking").isBoolean(), body("providesCarry").isBoolean()],
  validateRequest,
  partnerController.applyAsPartner
);

router.get("/status", partnerController.getPartnerStatus);
router.get("/location", requireKycVerified, partnerController.getPartnerLocation);
router.get("/nearby-bookings", requireKycVerified, partnerController.getNearbyBookings);
router.get("/bookings", requireKycVerified, partnerController.getPartnerBookings);
router.get("/performance", requireKycVerified, partnerController.getPerformance);
router.get("/:id/ratings", partnerController.getPartnerRatings);

router.put(
  "/availability",
  requireKycVerified,
  [body("isAvailable").isBoolean()],
  validateRequest,
  partnerController.toggleAvailability
);

router.put(
  "/location",
  requireKycVerified,
  [
    body("latitude").isFloat({ min: -90, max: 90 }).withMessage("Latitude must be between -90 and 90"),
    body("longitude").isFloat({ min: -180, max: 180 }).withMessage("Longitude must be between -180 and 180"),
  ],
  validateRequest,
  partnerController.updateLocation
);

router.put(
  "/services",
  requireKycVerified,
  [body("providesWalking").isBoolean(), body("providesCarry").isBoolean()],
  validateRequest,
  partnerController.updateServices
);

router.post("/bookings/:id/accept", requireKycVerified, partnerController.acceptBooking);
router.post("/bookings/:id/reject", requireKycVerified, partnerController.rejectBooking);
router.post("/bookings/:id/otp/generate", requireKycVerified, partnerController.generateOTP);
router.post(
  "/bookings/:id/otp/verify",
  requireKycVerified,
  [body("otp").notEmpty()],
  validateRequest,
  partnerController.verifyOTP
);
// Controlled workflow (spec 84-100): travel, start-code entry, and completion
// requests live here; the codes themselves are issued to the USER only.
router.post("/bookings/:id/go", requireKycVerified, bookingController.goToJob);
router.post("/bookings/:id/arrived", requireKycVerified, bookingController.markArrivedHandler);
router.post(
  "/bookings/:id/start-verify",
  requireKycVerified,
  [body("startOtp").notEmpty().trim().isLength({ min: 4, max: 10 })],
  validateRequest,
  bookingController.verifyStartOtpHandler
);
router.post("/bookings/:id/request-completion", requireKycVerified, bookingController.requestCompletionHandler);
router.post(
  "/bookings/:id/complete",
  requireKycVerified,
  [body("completionOtp").optional().isString().trim().isLength({ min: 4, max: 10 })],
  validateRequest,
  partnerController.completeBooking
);

export default router;

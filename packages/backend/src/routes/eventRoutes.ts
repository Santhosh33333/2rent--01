import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { upload } from "../middleware/upload";
import * as eventController from "../controllers/eventController";
import * as eventPaymentController from "../controllers/eventPaymentController";
import * as eventChatController from "../controllers/eventChatController";
import * as eventEscrowController from "../controllers/eventEscrowController";
import { requireReConsent } from "../middleware/legalConsent";

const router = Router();

router.use(authenticateToken, requireKycVerified);

// Event categories (with admin enable/disable flags)
router.get("/categories", eventController.getEventCategories);

// Create event
router.post(
  "/",
  [
    body("title").notEmpty().trim().isLength({ min: 3, max: 200 }),
    body("description").optional().isString().trim().isLength({ max: 1000 }),
    body("startTime").isISO8601().withMessage("Valid startTime required"),
    body("endTime").optional().isISO8601().withMessage("Valid endTime format"),
    body("capacity").optional().isInt({ min: 1, max: 10000 }),
    body("location").optional().isString().trim().isLength({ max: 500 }),
    body("communityId").optional().isString(),
    body("coverImageUrl").optional().isString().trim().isLength({ max: 500 }),
    body("category").optional().isString().trim().isLength({ max: 32 }),
    body("subcategory").optional().isString().trim().isLength({ max: 32 }),
    body("privacy").optional().isIn(["PUBLIC", "PRIVATE"]),
    body("price").optional().isFloat({ min: 0 }),
    // Discovery/filter columns. Range + lat/lon pairing checks live in the
    // controller so the error messages stay specific.
    body("latitude").optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body("longitude").optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
    body("onlineUrl").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("isOnline").optional().isBoolean(),
    body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
    body("timezone").optional().isString().trim().isLength({ max: 64 }),
    body("womenOnly").optional().isBoolean(),
  ],
  sanitizeInput,
  validateRequest,
  eventController.createEvent
);

// Get events list
router.get("/", eventController.getEvents);

// Get event by ID
router.get("/:id", eventController.getEventById);

// Update event (organizer only)
router.put(
  "/:id",
  [
    body("title").optional().trim().isLength({ min: 3, max: 200 }),
    body("description").optional().isString().trim().isLength({ max: 1000 }),
    body("startTime").optional().isISO8601(),
    body("endTime").optional().isISO8601(),
    body("capacity").optional().isInt({ min: 1, max: 10000 }),
    body("location").optional().isString().trim(),
    body("status").optional().isIn(["PUBLISHED", "CANCELLED", "COMPLETED"]),
    body("coverImageUrl").optional().isString().trim().isLength({ max: 500 }),
    body("category").optional().isString().trim().isLength({ max: 32 }),
    body("subcategory").optional().isString().trim().isLength({ max: 32 }),
    body("privacy").optional().isIn(["PUBLIC", "PRIVATE"]),
    body("price").optional().isFloat({ min: 0 }),
    body("latitude").optional({ nullable: true }).isFloat({ min: -90, max: 90 }),
    body("longitude").optional({ nullable: true }).isFloat({ min: -180, max: 180 }),
    body("onlineUrl").optional({ nullable: true }).isString().trim().isLength({ max: 500 }),
    body("isOnline").optional().isBoolean(),
    body("currency").optional().isString().trim().isLength({ min: 3, max: 3 }),
    body("timezone").optional().isString().trim().isLength({ max: 64 }),
    body("womenOnly").optional().isBoolean(),
  ],
  sanitizeInput,
  validateRequest,
  eventController.updateEvent
);

// Upload event cover (organizer only)
router.post("/:id/cover", upload.single("cover"), eventController.uploadEventCover);

// Delete event (organizer only)
router.delete("/:id", eventController.deleteEvent);

// Register for event
router.post("/:id/register", eventController.registerForEvent);

// Cancel registration
router.post("/:id/cancel", eventController.cancelRegistration);

// Check in to event
router.post("/:id/checkin", eventController.checkInEvent);

// Get event attendees
  router.get("/:id/attendees", eventController.getEventAttendees);

  // --- Event cost sheet ---------------------------------------------------------
  // The organizer sets one per-person amount (usually a common preset) and the
  // per-attendee total is derived from it, then tracked share by share.
  router.get("/:id/cost-sheet", eventPaymentController.getEventCostSheet);
  router.put("/:id/cost-sheet", eventPaymentController.setEventAmount);
  router.post("/:id/cost-sheet/waive", eventPaymentController.waiveEventShare);
  router.post("/:id/cost-sheet/pay", eventPaymentController.payEventShare);

  // --- Event fee escrow ---------------------------------------------------------
  // `report` is the action that stops the organizer's payout: filing it freezes
  // every held fee on the event until an admin decides. No validator middleware
  // here on purpose - the controller checks the reason against the real list and
  // returns specific messages, and `sanitizeInput` would strip the description
  // an admin needs in order to review the report at all.
  router.post("/:id/report", eventEscrowController.reportEvent);
  // Where the organizer's money is: held, released, or frozen pending a review.
  router.get("/:id/escrow", eventEscrowController.getEventEscrowStatus);
  // Everything held on the CALLER's own behalf, across all events. Lives here
  // rather than under /admin because it is the payer's own money, not an
  // operator view of it.
  router.get("/escrow/mine", eventEscrowController.getMyEscrow);

// --- Event group thread -------------------------------------------------------
// Restricted to the organizer and the event's attendees; the controller enforces
// membership, not just authentication, so these cannot be read app-wide.
router.get(
  "/:id/messages",
  authenticateToken,
  requireKycVerified,
  requireReConsent(),
  eventChatController.getEventMessages
);

router.post(
  "/:id/messages",
  authenticateToken,
  requireKycVerified,
  [
    body("content").optional().isString().trim().isLength({ max: 2000 }),
    body("messageType").optional().isIn(["TEXT", "IMAGE"]),
    body("mediaUrl").optional().isString().trim().isLength({ max: 500 }),
  ],
  sanitizeInput,
  validateRequest,
  requireReConsent(),
  eventChatController.sendEventMessage
);

router.delete(
  "/:id/messages/:messageId",
  authenticateToken,
  requireKycVerified,
  eventChatController.deleteEventMessage
);

export default router;


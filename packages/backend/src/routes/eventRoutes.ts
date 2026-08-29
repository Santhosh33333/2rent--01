import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireKycVerified } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as eventController from "../controllers/eventController";

const router = Router();

router.use(authenticateToken, requireKycVerified);

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
  ],
  sanitizeInput,
  validateRequest,
  eventController.updateEvent
);

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

export default router;


import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { upload } from "../middleware/upload";
import * as userController from "../controllers/userController";

const router = Router();

router.use(authenticateToken);

// Profile endpoints
router.get("/profile", userController.getProfile);
router.get("/profile/full", userController.getProfileFull);
router.get("/profile/stats", userController.getProfileStats);

// Update profile
router.put(
  "/profile",
  [
    body("fullName").optional().notEmpty().trim().isLength({ min: 2, max: 100 }),
    body("bio").optional().isString().trim().isLength({ max: 500 }),
    body("city").optional().isString().trim().isLength({ max: 100 }),
    body("country").optional().isString().trim().isLength({ max: 100 }),
    body("gender").optional().isIn(["MALE", "FEMALE", "OTHER"]),
  ],
  sanitizeInput,
  validateRequest,
  userController.updateProfile
);

// Upload profile photo
router.post("/profile-photo", upload.single("photo"), userController.uploadProfilePhoto);

// Account management
router.delete("/account", userController.deleteAccount);

// Login history
router.get("/login-history", userController.getLoginHistory);

// Device management
router.get("/devices", userController.getDevices);
router.delete("/devices/:id", userController.removeDevice);

// Trust score
router.get("/trust-score", userController.trustScore);

// Block management
router.post(
  "/block",
  [body("userId").notEmpty().isString()],
  sanitizeInput,
  validateRequest,
  userController.blockUser
);
router.delete("/block/:id", userController.unblockUser);
router.get("/blocked", userController.getBlockedUsers);

// Reporting
router.post(
  "/report",
  [
    body("targetId").notEmpty().isString(),
    body("targetType").optional().isIn(["USER", "COMMUNITY", "EVENT", "BOOKING"]),
    body("reason").notEmpty().isString().trim().isLength({ max: 100 }),
    body("description").optional().isString().trim().isLength({ max: 1000 }),
  ],
  sanitizeInput,
  validateRequest,
  userController.reportUser
);

// SOS (Safety features)
router.get("/sos/status", userController.getSosStatus);
router.post(
  "/sos/trigger",
  [
    body("latitude").isFloat({ min: -90, max: 90 }),
    body("longitude").isFloat({ min: -180, max: 180 }),
    body("message").optional().isString().trim().isLength({ max: 500 }),
  ],
  sanitizeInput,
  validateRequest,
  userController.triggerSos
);
router.post("/sos/cancel", userController.cancelSos);

export default router;

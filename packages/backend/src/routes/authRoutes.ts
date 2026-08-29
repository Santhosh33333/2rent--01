import { Router } from "express";
import { body } from "express-validator";
import { authRateLimiter } from "../middleware/rateLimiter";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { authenticateToken } from "../middleware/auth";
import * as authController from "../controllers/authController";
import * as clerkAuthController from "../controllers/clerkAuthController";

const router = Router();

router.post(
  "/register",
  authRateLimiter,
  [
    body("email").isEmail().normalizeEmail().withMessage("Valid email is required"),
    body("phone").isMobilePhone("any").withMessage("Valid phone is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("fullName").notEmpty().withMessage("Full name is required"),
    body("dateOfBirth").isISO8601().withMessage("Valid date of birth is required"),
    body("gender").isIn(["MALE", "FEMALE", "OTHER"]).withMessage("Valid gender is required"),
  ],
  sanitizeInput,
  validateRequest,
  authController.register
);

router.post(
  "/login",
  authRateLimiter,
  [body("email").isEmail().withMessage("Valid email is required"), body("password").notEmpty().withMessage("Password is required")],
  validateRequest,
  authController.login
);

// Phone OTP Login (Firebase)
router.post(
  "/phone/send-otp",
  authRateLimiter,
  [body("phone").isMobilePhone("any").withMessage("Valid phone is required")],
  validateRequest,
  authController.sendPhoneOTP
);

router.post(
  "/phone/verify-otp",
  authRateLimiter,
  [body("phone").isMobilePhone("any").withMessage("Valid phone is required"), body("otp").isLength({ min: 6, max: 6 }).withMessage("6-digit OTP is required")],
  validateRequest,
  authController.verifyPhoneOTP
);

// Google Sign-In
router.post(
  "/google",
  authRateLimiter,
  [body("idToken").notEmpty().withMessage("Google ID token is required")],
  validateRequest,
  authController.googleSignIn
);

// Apple Sign-In
router.post(
  "/apple",
  authRateLimiter,
  [body("idToken").notEmpty().withMessage("Apple ID token is required"), body("fullName").optional().isObject()],
  validateRequest,
  authController.appleSignIn
);

router.post("/logout", authController.logout);

// Switch active account role (USER <-> PARTNER); backend-enforced
router.post(
  "/switch-role",
  authenticateToken,
  [body("role").notEmpty().isIn(["USER", "PARTNER"]).withMessage("Role must be USER or PARTNER")],
  validateRequest,
  authController.switchRole
);

router.post(
  "/refresh-token",
  [body("refreshToken").notEmpty().withMessage("Refresh token is required")],
  validateRequest,
  authController.refreshToken
);

router.post(
  "/forgot-password",
  authRateLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  validateRequest,
  authController.forgotPassword
);

router.post(
  "/reset-password",
  authRateLimiter,
  [body("email").isEmail().normalizeEmail(), body("otp").isLength({ min: 4, max: 8 }), body("newPassword").isLength({ min: 8 })],
  validateRequest,
  authController.resetPassword
);

router.post(
  "/verify-email",
  authRateLimiter,
  [body("userId").notEmpty(), body("otp").isLength({ min: 4, max: 8 })],
  validateRequest,
  authController.verifyEmail
);

router.post(
  "/verify-mobile",
  authRateLimiter,
  [body("userId").notEmpty(), body("otp").isLength({ min: 4, max: 8 })],
  validateRequest,
  authController.verifyMobile
);

router.post(
  "/resend-otp",
  authRateLimiter,
  [body("userId").notEmpty(), body("channel").isIn(["email", "mobile"])],
  validateRequest,
  authController.resendOTP
);

router.post(
  "/verify-password",
  authRateLimiter,
  [body("email").isEmail().normalizeEmail(), body("password").notEmpty()],
  validateRequest,
  authController.verifyPassword
);

// Clerk sync - exchange Clerk session token for our JWT
router.post(
  "/clerk",
  authRateLimiter,
  [body("token").notEmpty().withMessage("Clerk session token is required")],
  validateRequest,
  clerkAuthController.clerkSync
);

export default router;

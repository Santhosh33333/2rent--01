import { Router } from "express";
import { body } from "express-validator";
import { authRateLimiter, otpSendLimiter, otpVerifyLimiter } from "../middleware/rateLimiter";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { authenticateToken } from "../middleware/auth";
import * as authController from "../controllers/authController";
import * as otpController from "../controllers/otpController";

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
  otpSendLimiter,
  [body("phone").isMobilePhone("any").withMessage("Valid phone is required")],
  validateRequest,
  authController.sendPhoneOTP
);

router.post(
  "/phone/verify-otp",
  otpVerifyLimiter,
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

// Email/SMS OTP (DB-backed, purpose-bound, provider-honest). Login and
// password-reset codes are public; verification codes use resend-otp.
router.get("/otp/channels", otpController.otpChannels);
router.post(
  "/otp/request",
  otpSendLimiter,
  [
    body("channel").isIn(["EMAIL", "SMS", "email", "sms"]).withMessage("Channel must be EMAIL or SMS"),
    body("identifier").notEmpty().withMessage("Email or phone is required"),
    body("purpose").isIn(["LOGIN", "PASSWORD_RESET", "login", "password_reset"]).withMessage("Purpose must be LOGIN or PASSWORD_RESET"),
  ],
  validateRequest,
  otpController.requestOtp
);
router.post(
  "/otp/verify",
  otpVerifyLimiter,
  [
    body("channel").isIn(["EMAIL", "SMS", "email", "sms"]).withMessage("Channel must be EMAIL or SMS"),
    body("identifier").notEmpty().withMessage("Email or phone is required"),
    body("code").notEmpty().isLength({ min: 4, max: 10 }).withMessage("Code is required"),
    body("purpose").isIn(["LOGIN", "PASSWORD_RESET", "login", "password_reset"]).withMessage("Purpose must be LOGIN or PASSWORD_RESET"),
  ],
  validateRequest,
  otpController.verifyOtpLogin
);

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
  otpSendLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  validateRequest,
  authController.forgotPassword
);

router.post(
  "/reset-password",
  otpVerifyLimiter,
  [body("email").isEmail().normalizeEmail(), body("otp").isLength({ min: 4, max: 8 }), body("newPassword").isLength({ min: 8 })],
  validateRequest,
  authController.resetPassword
);

router.post(
  "/verify-email",
  otpVerifyLimiter,
  [body("userId").notEmpty(), body("otp").isLength({ min: 4, max: 8 })],
  validateRequest,
  authController.verifyEmail
);

router.post(
  "/verify-mobile",
  otpVerifyLimiter,
  [body("userId").notEmpty(), body("otp").isLength({ min: 4, max: 8 })],
  validateRequest,
  authController.verifyMobile
);

router.post(
  "/resend-otp",
  otpSendLimiter,
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

export default router;

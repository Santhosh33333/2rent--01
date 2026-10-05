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
    // Shape only. The rule for what a valid Indian number is lives in
    // services/phoneNumber and is applied in the controller, because
    // `validateRequest` answers any failure with a bare "Validation failed." and
    // never forwards the per-field message - so a strict validator here would
    // reject `+91 98200 12345` (validator.js does not tolerate the spaces) while
    // telling the user nothing. The upper bound stops an unbounded string
    // reaching the database.
    body("phone").isString().trim().isLength({ min: 1, max: 20 }).withMessage("Mobile number is required"),
    body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters"),
    body("fullName").notEmpty().withMessage("Full name is required"),
    body("dateOfBirth").isISO8601().withMessage("Valid date of birth is required"),
    body("gender").isIn(["MALE", "FEMALE", "OTHER"]).withMessage("Valid gender is required"),
    // Signup is where the terms are actually agreed to. The checkbox in the app
    // is a convenience; this is the control, so a client that skips it cannot
    // create an account that is already bound to terms it never accepted.
    // Accepts a real boolean or its string form, because JSON and form encoders
    // disagree on this and neither may be treated as consent by accident.
    body("legalConsent").isObject().withMessage("You must accept the terms to continue"),
    body("legalConsent.accepted")
      .custom((v) => v === true || v === "true")
      .withMessage("You must accept the terms to continue"),
    body("legalConsent.signatureValue").isString().trim().isLength({ min: 2, max: 120 }).withMessage("Type your full name to sign"),
  ],
  sanitizeInput,
  validateRequest,
  authController.register
);

/**
 * A sign-in identifier is EITHER an email address OR a phone number.
 *
 * This used to be `isEmail()` on whatever arrived in the `email` field, so a
 * ten-digit number was rejected 422 VALIDATION_ERROR as a malformed address and
 * never reached the controller that knows how to resolve it. That made phone
 * sign-in unreachable however the UI offered it - and it stays live for any
 * client that posts the legacy `{ email, password }` shape, such as an APK built
 * before the `identifier` field existed.
 *
 * Shape-only on purpose. The real rules (exactly ten digits, an Indian mobile
 * prefix, no sample-number runs) belong to the parser, which the controller owns;
 * this check only rejects a value that is neither an address nor a number.
 */
const isSignInIdentifier = (v: string): boolean =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.replace(/\D/g, "").length >= 10;

router.post(
  "/login",
  authRateLimiter,
  [
    // `identifier` is what the controller actually reads
    // (`identifier || email || phone`), and it is validated as an opaque string
    // precisely so a number is never format-checked as an address.
    body("identifier").optional().isString().trim().isLength({ min: 3, max: 100 }),
    // `email` and `phone` stay optional: requiring both locked out phone-only
    // sign-in, and an absent value must not count as a failure.
    body("email")
      .optional()
      .isString()
      .trim()
      .custom(isSignInIdentifier)
      .withMessage("Enter a valid email address, or sign in with your 10-digit mobile number"),
    body("phone").optional().isString().trim().isLength({ min: 3, max: 20 }),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validateRequest,
  authController.login
);

// Phone OTP Login (Firebase)
//
// Shape-only validation, deliberately. `isMobilePhone("any")` is a strict E.164
// check that runs BEFORE the controller's tolerant `phoneLookupCandidates`
// lookup, so a member who typed their number the way it is stored (`+91…`) or
// with spaces was rejected 422 VALIDATION_ERROR before any lookup could happen,
// and the specific "that number isn't registered" answer never reached them.
// The real rules (ten digits, valid Indian prefix, no sample runs) all live in
// the parser, which the controller owns on purpose.
const phoneShape = [
  body("phone")
    .isString()
    .trim()
    .isLength({ min: 10, max: 20 })
    .withMessage("Enter your 10-digit mobile number"),
];

router.post(
  "/phone/send-otp",
  otpSendLimiter,
  phoneShape,
  validateRequest,
  authController.sendPhoneOTP
);

router.post(
  "/phone/verify-otp",
  otpVerifyLimiter,
  [...phoneShape, body("otp").isLength({ min: 6, max: 6 }).withMessage("6-digit OTP is required")],
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

// Inline email verification during signup (before the account exists).
router.post(
  "/signup/request-otp",
  otpSendLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required")],
  validateRequest,
  otpController.requestSignupEmailOtp
);
router.post(
  "/signup/verify-otp",
  otpVerifyLimiter,
  [body("email").isEmail().normalizeEmail().withMessage("Valid email is required"), body("code").isLength({ min: 4, max: 8 }).withMessage("Code is required")],
  validateRequest,
  otpController.verifySignupEmailOtp
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

import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { privateUpload } from "../middleware/upload";
import * as verificationController from "../controllers/verificationController";

const router = Router();

router.use(authenticateToken);

// ============================================================================
// STEP 1: PERSONAL DETAILS
// ============================================================================
router.post(
  "/personal-details",
  [
    body("fullName").isString().trim().isLength({ min: 2, max: 100 }).withMessage("Full name must be 2 to 100 characters"),
    body("dateOfBirth").isISO8601({ strict: true, strictSeparator: true }).withMessage("A valid date of birth is required"),
    body("gender").notEmpty().isIn(["MALE", "FEMALE", "OTHER"]).withMessage("Valid gender is required"),
    // Shape only - see the note in authRoutes. The controller applies the real
    // rule and, critically, compares this against the number on the account, so
    // it must not be reduced to a format check here.
    body("phone").isString().trim().isLength({ min: 1, max: 20 }).withMessage("Mobile number is required"),
    body("city").optional().isString().trim().isLength({ max: 100 }),
    body("country").optional().isString().trim().isLength({ max: 100 }),
    body("address").optional().isString().trim().isLength({ max: 500 }),
  ],
  sanitizeInput,
  validateRequest,
  verificationController.submitPersonalDetails
);

// ============================================================================
// STEP 2: GOVERNMENT ID UPLOAD
// ============================================================================
router.post(
  "/gov-id",
  privateUpload.single("govId"),
  [body("govIdType").notEmpty().isIn(["AADHAAR", "PASSPORT", "DRIVING_LICENSE", "VOTER_ID", "PAN"]).withMessage("Valid document type is required")],
  validateRequest,
  verificationController.submitGovId
);

// ============================================================================
// STEP 3: SELFIE VERIFICATION
// ============================================================================
router.post("/selfie", privateUpload.single("selfie"), verificationController.submitSelfie);

// ============================================================================
// STEP 4: ADDRESS PROOF
// ============================================================================
router.post(
  "/address",
  privateUpload.single("addressProof"),
  verificationController.submitAddressProof
);

// ============================================================================
// STEP 5: EMERGENCY CONTACT
// ============================================================================
router.post(
  "/emergency-contact",
  [
    body("name").notEmpty().withMessage("Name is required"),
    // Shape only; the controller applies the number rule and returns a specific
    // reason. See the note on /personal-details.
    body("phone").isString().trim().isLength({ min: 1, max: 20 }).withMessage("Valid phone is required"),
    body("relation").notEmpty().withMessage("Relationship is required"),
    body("email").isEmail().withMessage("Valid emergency contact email is required"),
  ],
  sanitizeInput,
  validateRequest,
  verificationController.submitEmergencyContact
);

// ============================================================================
// STEP 6: SUBMIT FOR VERIFICATION
// ============================================================================
router.post("/submit", verificationController.submitForVerification);

// ============================================================================
// GET STATUS & HISTORY
// ============================================================================
router.get("/status", verificationController.getVerificationStatus);
router.get("/history", verificationController.getVerificationHistory);

// ============================================================================
// DELETE DOCUMENT
// ============================================================================
router.delete("/document/:docType", verificationController.deleteDocument);

export default router;

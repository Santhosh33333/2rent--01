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
    body("fullName").notEmpty().withMessage("Full name is required"),
    body("dateOfBirth").notEmpty().withMessage("Date of birth is required"),
    body("gender").notEmpty().isIn(["MALE", "FEMALE", "OTHER"]).withMessage("Valid gender is required"),
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
    body("phone").isMobilePhone("any").withMessage("Valid phone is required"),
    body("relation").notEmpty().withMessage("Relationship is required"),
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

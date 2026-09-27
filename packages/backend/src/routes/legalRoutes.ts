import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as legalController from "../controllers/legalController";

const router = Router();

// Document text must be readable before sign-in so the review step is not a
// dead end for someone who has not accepted anything yet.
router.get("/documents", authenticateToken, legalController.listLegalDocuments);
router.get("/documents/:kind", authenticateToken, legalController.getLegalDocument);

router.post(
  "/accept",
  authenticateToken,
  [
    body("kind").notEmpty().trim().isLength({ max: 64 }),
    body("signatureType").optional().isIn(["TYPED_NAME", "DRAWN"]),
    body("signatureValue").notEmpty().trim(),
    body("consentType").notEmpty().isIn(["SIGNUP", "PARTNER_ONBOARDING", "BOOKING", "RE_CONSENT"]),
  ],
  sanitizeInput,
  validateRequest,
  legalController.acceptLegalDocument
);

router.get("/consent", authenticateToken, legalController.getMyConsentStatus);
router.get("/acceptances", authenticateToken, legalController.getMyAcceptances);

export default router;

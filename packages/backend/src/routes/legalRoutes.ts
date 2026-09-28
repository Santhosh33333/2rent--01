import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as legalController from "../controllers/legalController";

const router = Router();

// Document text requires auth: a member must have an account to read and sign,
// and the review step is reached from inside the app. The endpoint is
// deliberately readable BEFORE acceptance, so a user blocked by the consent gate
// can always see exactly what they are being asked to sign.
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

// Readable before acceptance on purpose: a person who is blocked by the
// re-consent gate must still be able to see what they are being asked to sign.
router.get("/re-consent", authenticateToken, legalController.getMyReConsentState);

export default router;

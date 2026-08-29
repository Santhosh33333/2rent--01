import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as referralController from "../controllers/referralController";

const router = Router();

router.use(authenticateToken);

router.get("/me", referralController.getMyReferralProfile);
router.post(
  "/apply",
  [body("code").notEmpty().isString().withMessage("Referral code is required")],
  sanitizeInput,
  validateRequest,
  referralController.applyReferralCode
);
router.get("/", referralController.listMyReferrals);

export default router;

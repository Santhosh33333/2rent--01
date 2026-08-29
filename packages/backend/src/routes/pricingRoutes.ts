import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as pricingController from "../controllers/pricingController";

const router = Router();

router.use(authenticateToken);

router.get("/estimate", pricingController.getPriceBreakdown);
router.get("/earnings", pricingController.getEarningsDashboard);
router.get("/earnings/details", pricingController.getEarningDetails);
router.get("/earnings/statement", pricingController.downloadStatement);
router.get("/earnings/receipt/:id", pricingController.downloadReceipt);
router.post(
  "/coupon/apply",
  [body("code").notEmpty().withMessage("Coupon code is required"), body("amount").isFloat({ gt: 0 }).withMessage("Amount must be greater than 0")],
  sanitizeInput,
  validateRequest,
  pricingController.applyCoupon
);

export default router;
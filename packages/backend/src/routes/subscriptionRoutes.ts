import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import * as subscriptionController from "../controllers/subscriptionController";
import * as subscriptionWebhookController from "../controllers/subscriptionWebhookController";

const router = Router();

// Webhooks first: unauthenticated, signature-verified inside the handler.
// Registered before router.use(authenticateToken) so it cannot be guarded.
router.post("/webhook/cashfree", subscriptionWebhookController.subscriptionWebhook);
router.get("/webhook/cashfree", subscriptionWebhookController.subscriptionWebhookHealth);

// Pricing is readable without a session so the paywall can render before login.
// The values still come only from the backend; the frontend never hardcodes them.
router.get("/plans", subscriptionController.listPlans);

router.use(authenticateToken);

router.get("/me", subscriptionController.getMySubscription);

router.post(
  "/subscribe",
  [body("planCode").notEmpty().withMessage("Plan code is required").isString()],
  validateRequest,
  subscriptionController.subscribe,
);

// The QR for a subscription payment raised by the wallet-short path. Kept off the
// subscribe response on purpose: the amount owed lives on the payment row, so a
// page reload can recover the QR instead of stranding the user with no way to pay.
router.get("/payments/:id/upi-details", subscriptionController.getSubscriptionUpiDetails);

// The UTR the user read off their bank app. Stored for the admin to match, but it
// never activates the plan on its own.
router.post(
  "/payments/:id/reference",
  [body("referenceNumber").notEmpty().withMessage("Reference is required").isString()],
  validateRequest,
  subscriptionController.submitSubscriptionReference,
);

router.post(
  "/cancel",
  [body("reason").optional().isString().trim().isLength({ max: 500 })],
  validateRequest,
  subscriptionController.cancel,
);

router.post(
  "/change-plan",
  [body("planCode").notEmpty().withMessage("Plan code is required").isString()],
  validateRequest,
  subscriptionController.changePlan,
);

export default router;
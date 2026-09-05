import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken, requireAdmin, requireSuperAdmin } from "../middleware/auth";
import { requireSectionAction } from "../rbac/permissions";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as credit from "../controllers/creditLedgerController";
import * as offer from "../controllers/offerController";
import * as approval from "../controllers/approvalController";
import * as analytics from "../controllers/analyticsController";
import * as city from "../controllers/cityController";
import * as adminSecurity from "../controllers/adminSecurityController";

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

// ---------------- PROMOTIONAL CREDIT LEDGER (sections 9-13) ----------------
router.get("/credit/ledger", requireSectionAction("WALLETS", "VIEW"), credit.getCreditLedger);
router.post(
  "/credit/grant",
  requireSectionAction("WALLETS", "CREATE"),
  [body("userId").notEmpty(), body("amount").isFloat({ gt: 0 })],
  sanitizeInput,
  validateRequest,
  credit.grantPromotionalCredit
);
router.post("/credit/:id/reverse", requireSectionAction("WALLETS", "EDIT"), credit.reverseCredit);
router.get("/credit/rules", requireSectionAction("WALLETS", "VIEW"), credit.getCreditRules);
router.put("/credit/rules", requireSectionAction("WALLETS", "EDIT"), credit.updateCreditRules);

// ---------------- OFFERS LIFECYCLE (sections 7-8) ----------------
router.get("/offers", requireSectionAction("OFFERS", "VIEW"), offer.listOffers);
router.post(
  "/offers",
  requireSectionAction("OFFERS", "CREATE"),
  [body("code").notEmpty(), body("title").notEmpty(), body("type").notEmpty()],
  sanitizeInput,
  validateRequest,
  offer.createOffer
);
router.get("/offers/:id", requireSectionAction("OFFERS", "VIEW"), offer.getOffer);
router.put("/offers/:id", requireSectionAction("OFFERS", "EDIT"), offer.updateOffer);
router.post(
  "/offers/:id/status",
  requireSectionAction("OFFERS", "APPROVE"),
  [body("status").notEmpty()],
  sanitizeInput,
  validateRequest,
  offer.setOfferStatus
);
router.delete("/offers/:id", requireSectionAction("OFFERS", "DELETE"), offer.deleteOffer);

// ---------------- TWO-STEP APPROVAL WORKFLOW (section 18) ----------------
router.post("/approvals", requireAdmin, approval.createApprovalRequest);
router.get("/approvals", requireAdmin, approval.listApprovalRequests);
router.post(
  "/approvals/:id/review",
  requireSuperAdmin,
  [body("decision").isIn(["APPROVE", "REJECT"])],
  validateRequest,
  approval.reviewApproval
);

// ---------------- ADMIN ANALYTICS (section 29) ----------------
router.get("/analytics", requireSectionAction("ANALYTICS", "VIEW"), analytics.getAdminAnalytics);

// ---------------- CITY MANAGEMENT (section 27) ----------------
router.get("/cities", requireSectionAction("SYSTEM_SETTINGS", "VIEW"), city.listCities);
router.post(
  "/cities",
  requireSectionAction("SYSTEM_SETTINGS", "CREATE"),
  [body("key").notEmpty(), body("name").notEmpty()],
  sanitizeInput,
  validateRequest,
  city.createCity
);
router.put("/cities/:id", requireSectionAction("SYSTEM_SETTINGS", "EDIT"), city.updateCity);
router.delete("/cities/:id", requireSectionAction("SYSTEM_SETTINGS", "DELETE"), city.deleteCity);

// Identity + effective permissions (used by the admin console to render sections).
router.get("/profile", adminSecurity.getAdminProfile);

// ---------------- ADMIN ACCESS SECURITY ----------------
// Self-service: every authenticated admin can manage their own security posture.
// (Second-factor is mobile OTP, enforced at login — not configured here.)
router.get("/security/me", adminSecurity.getMySecurity);
router.patch(
  "/security/me",
  [body("ipAllowList").optional().isArray(), body("sessionLimit").optional().isInt({ min: 1, max: 20 }), body("loginAlertsEnabled").optional().isBoolean()],
  sanitizeInput,
  validateRequest,
  adminSecurity.updateMySecurity
);
router.get("/security/sessions", adminSecurity.listMySessions);
router.delete("/security/sessions/:sessionId", adminSecurity.revokeMySession);

// Super-admin only: inspect / harden any admin account.
router.get("/admins/:userId/security", requireSuperAdmin, adminSecurity.getAdminSecurity);
router.patch(
  "/admins/:userId/security",
  requireSuperAdmin,
  [body("ipAllowList").optional().isArray(), body("sessionLimit").optional().isInt({ min: 1, max: 20 }), body("loginAlertsEnabled").optional().isBoolean(), body("requirePasswordRotation").optional().isBoolean(), body("status").optional().isIn(["ACTIVE", "SUSPENDED", "DISABLED"])],
  sanitizeInput,
  validateRequest,
  adminSecurity.updateAdminSecurity
);
router.post("/admins/:userId/mfa-reset", requireSuperAdmin, adminSecurity.resetAdminMfa);

export default router;

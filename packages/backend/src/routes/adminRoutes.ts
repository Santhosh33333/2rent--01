import { Router } from "express";
import { body } from "express-validator";
import { authRateLimiter, generalRateLimiter } from "../middleware/rateLimiter";
import { authenticateToken, requireAdmin, requireSuperAdmin } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { requireSectionAction } from "../rbac/permissions";
import { upload, privateUpload, statementUpload } from "../middleware/upload";
import * as adminController from "../controllers/adminController";
import * as bankReconciliationController from "../controllers/bankReconciliationController";
import * as communityController from "../controllers/communityController";
import * as eventController from "../controllers/eventController";
import * as eventEscrowController from "../controllers/eventEscrowController";
import * as otpController from "../controllers/otpController";
import * as kycTrialController from "../controllers/kycTrialController";
import * as adminSubscriptionController from "../controllers/adminSubscriptionController";

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

// Section/action permission guards — backend-enforced (never trust the UI).
const users = requireSectionAction("USERS", "VIEW");
// Account-mutating actions (status change, block, impersonate) are above the
// VIEW tier: a MODERATOR holding only USERS.VIEW must never be able to ban or
// impersonate accounts. Only roles granted USERS.EDIT (or super admin) may.
const usersEdit = requireSectionAction("USERS", "EDIT");
const kycReview = requireSectionAction("KYC", "APPROVE");
const partnersManage = requireSectionAction("PARTNERS", "VIEW");
const bookingsView = requireSectionAction("BOOKINGS", "VIEW");
const withdrawalsManage = requireSectionAction("WITHDRAWALS", "VIEW");
const reportsManage = requireSectionAction("REPORTS", "VIEW");
const auditView = requireSectionAction("AUDIT_LOGS", "VIEW");
const notificationsSend = requireSectionAction("NOTIFICATIONS", "CREATE");
const pricingManage = requireSectionAction("PRICING", "VIEW");
const pricingEdit = requireSectionAction("PRICING", "EDIT");
const couponsManage = requireSectionAction("COUPONS", "VIEW");
const couponsEdit = requireSectionAction("COUPONS", "EDIT");
const areasManage = requireSectionAction("SYSTEM_SETTINGS", "VIEW");
const areasEdit = requireSectionAction("SYSTEM_SETTINGS", "EDIT");
const campaignsManage = requireSectionAction("OFFERS", "VIEW");
const revenueView = requireSectionAction("ANALYTICS", "VIEW");
const paymentsView = requireSectionAction("PAYMENTS", "VIEW");
const walletsView = requireSectionAction("WALLETS", "VIEW");
const dispatchView = requireSectionAction("DISPATCH", "VIEW");
const communitiesView = requireSectionAction("COMMUNITIES", "VIEW");
const eventsView = requireSectionAction("EVENTS", "VIEW");
const adminMgmtView = requireSectionAction("ADMIN_MANAGEMENT", "VIEW");

// Statement uploads are heavy (whole file in memory, PDF or workbook to decode)
// and the endpoint that moves real money. The general limiter is per-window and
// generous enough that a burst of statements would otherwise land as one
// expensive request each, so it gets its own tighter budget.
const paymentsUpload = generalRateLimiter;

router.get("/dashboard", adminController.getDashboardStats);

// Manual UPI / QR payment verification (temporary flow for personal UPI accounts)
router.get("/payments/upi", paymentsView, adminController.listUpiPayments);
router.post(
  "/payments/upi/:id/verify",
  requireSectionAction("PAYMENTS", "APPROVE"),
  [body("action").isIn(["VERIFY", "REJECT", "REQUEST_INFO"]), body("note").optional().isString()],
  sanitizeInput,
  validateRequest,
  adminController.verifyUpiPayment
);
router.get("/settings/upi", paymentsView, adminController.getUpiConfig);
router.put(
  "/settings/upi",
  requireSectionAction("PAYMENTS", "EDIT"),
  [
    body("upiId").notEmpty().isString(),
    body("accountName").optional().isString(),
    body("qrUrl").optional().isString(),
  ],
  sanitizeInput,
  validateRequest,
  adminController.setUpiConfig
);
// Subscription payments collected by manual UPI. Same gate as every other money
// decision (PAYMENTS/APPROVE): verifying one activates a plan, so it must not be
// reachable from a read-only payments role.
router.get("/payments/subscriptions", paymentsView, adminController.listSubscriptionPayments);
router.post(
  "/payments/subscriptions/:id/verify",
  requireSectionAction("PAYMENTS", "APPROVE"),
  [body("action").isIn(["VERIFY", "REJECT", "REQUEST_INFO"]), body("note").optional().isString()],
  sanitizeInput,
  validateRequest,
  adminController.verifySubscriptionPayment
);

router.get("/users", users, adminController.getUsers);
router.get("/users/:id", users, adminController.getUserById);
router.put("/users/:id/status", usersEdit, [body("status").isIn(["ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"])], validateRequest, adminController.updateUserStatus);
// Shape only - the controller applies the number rule so the admin gets the
// specific reason. `isLength({ min: 10, max: 15 })` here accepted "abcdefghij".
router.put("/users/:id/phone", usersEdit, [body("phone").isString().trim().isLength({ min: 1, max: 20 })], sanitizeInput, validateRequest, adminController.updateUserPhone);
router.post("/users/:id/impersonate", usersEdit, adminController.impersonateUser);
router.post(
  "/users/:id/block",
  usersEdit,
  [
    body("durationDays").optional().isFloat({ gt: 0 }),
    body("durationYears").optional().isFloat({ gt: 0 }),
    body("permanent").optional().isBoolean(),
    body("reason").optional().isString(),
  ],
  sanitizeInput,
  validateRequest,
  adminController.blockUser
);
router.post("/users/:id/unblock", usersEdit, adminController.unblockUser);
router.post("/sos/:id/resolve", users, adminController.resolveSosAlert);
router.get("/sos/alerts", users, adminController.listSosAlerts);
router.post("/demo/refill", requireSuperAdmin, adminController.refillDemoWallet);
router.post("/demo/purge-test-payments", requireSuperAdmin, adminController.purgeTestPayments);
router.get("/otp/status", users, otpController.otpStatus);
router.get("/topup-requests", paymentsView, adminController.listTopupRequests);
router.post("/topup-requests/:id/verify", paymentsView, adminController.verifyTopupRequest);
// ---- Bank statement reconciliation ----------------------------------------
//
// Reading a statement is PAYMENTS VIEW; crediting wallets from it is PAYMENTS
// APPROVE, the same permission the single-request verify button needs. The two
// are deliberately split so a payments viewer can prepare the queue without
// being able to move money off it.
router.get("/bank-statements", paymentsView, bankReconciliationController.list);
router.get("/bank-statements/unresolved", paymentsView, bankReconciliationController.unresolved);
router.post(
  "/bank-statements",
  paymentsUpload,
  statementUpload.single("statement"),
  bankReconciliationController.upload,
);
router.get("/bank-statements/:id", paymentsView, bankReconciliationController.detail);
router.post("/bank-statements/:id/rematch", paymentsView, bankReconciliationController.rematch);
router.post(
  "/bank-statements/:id/apply",
  requireSectionAction("PAYMENTS", "APPROVE"),
  [body("note").optional().isString().isLength({ max: 500 })],
  sanitizeInput,
  validateRequest,
  bankReconciliationController.apply,
);
// Declared after /bank-statements/:id so "rows" is not swallowed as an id.
router.post(
  "/bank-statements/rows/:rowId/decision",
  requireSectionAction("PAYMENTS", "APPROVE"),
  [
    // Every message is spelled out. `validateRequest` forwards these verbatim,
    // and the default express-validator text ("Invalid value") tells an admin
    // nothing about which field is wrong or what to type instead.
    body("decision")
      .isIn(["CREDIT", "REJECT", "IGNORE"])
      .withMessage("Choose CREDIT, REJECT or IGNORE."),
    // The comment is not optional anywhere in this flow, and it is the only
    // record of why a human overrode a line the matcher refused. Validating its
    // length here means the client is told what is missing before the service
    // decides whether the whole request is admissible.
    body("comment")
      .isString()
      .bail()
      .withMessage("Say why: a comment of at least 5 characters is required on every line you decide.")
      .trim()
      .isLength({ min: 5, max: 1000 })
      .withMessage("The comment must be between 5 and 1000 characters."),
    body("matchedType")
      .optional()
      .isIn(["TOPUP", "UPI_PAYMENT"])
      .withMessage("matchedType must be TOPUP or UPI_PAYMENT."),
    body("matchedId").optional().isString(),
  ],
  sanitizeInput,
  validateRequest,
  bankReconciliationController.decide,
);
router.post("/wallets/credit", requireSuperAdmin, adminController.creditUserWallet);
router.delete("/users/:id", requireSuperAdmin, adminController.deleteUser);
// Bulk selection for the admin user list. Separate route (not DELETE
// /users/:id repeated client-side) so one audit trail covers the batch and the
// server can refuse protected ids without N round trips.
router.post("/users/bulk-action", requireSuperAdmin, adminController.bulkUserAction);
router.delete("/communities/:id", requireSuperAdmin, communityController.adminDeleteCommunity);
router.get("/kyc-queue", kycReview, adminController.getKycQueue);
router.post("/kyc/:id/approve", requireSectionAction("KYC", "APPROVE"), adminController.approveKyc);
router.post("/kyc/:id/reject", requireSectionAction("KYC", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectKyc);
// Bounded KYC trial: lets an admin admit one named user without completed KYC
// for a limited window. Gated on KYC MANAGE rather than SUPER_ADMIN because KYC
// staff are the people who know which applicants are legitimate testers, but
// still audited per grant since it deliberately relaxes an identity gate.
router.get("/kyc-trials", requireSectionAction("KYC", "APPROVE"), kycTrialController.listTrialCandidates);
router.post("/kyc-trials/:id/grant", requireSectionAction("KYC", "APPROVE"), [body("days").optional().isInt({ min: 1, max: 30 })], sanitizeInput, validateRequest, kycTrialController.grantKycTrial);
router.post("/kyc-trials/:id/revoke", requireSectionAction("KYC", "APPROVE"), kycTrialController.revokeKycTrial);
router.get("/walking-partners", partnersManage, adminController.getWalkingPartners);
router.post("/walking-partners/:id/approve", requireSectionAction("PARTNERS", "APPROVE"), adminController.approveWalkingPartner);
router.post("/walking-partners/:id/reject", requireSectionAction("PARTNERS", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectWalkingPartner);
router.post("/walking-partners/:id/suspend", requireSectionAction("PARTNERS", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.suspendPartner);
router.post("/walking-partners/:id/reactivate", requireSectionAction("PARTNERS", "APPROVE"), adminController.reactivatePartner);
router.get("/bookings", bookingsView, adminController.getBookings);
router.get("/bookings/:id", bookingsView, adminController.getBookingDetail);
router.get("/withdrawals", withdrawalsManage, adminController.getWithdrawalRequests);
router.get("/agreements", requireSectionAction("AGREEMENTS", "VIEW"), adminController.getAgreements);
router.get("/agreements/:id", requireSectionAction("AGREEMENTS", "VIEW"), adminController.getAgreementDetail);
// Versioned legal documents + the consent ledger.
router.get("/legal-documents", requireSectionAction("AGREEMENTS", "VIEW"), adminController.getLegalDocuments);
router.post(
  "/legal-documents",
  requireSectionAction("AGREEMENTS", "EDIT"),
  sanitizeInput,
  adminController.publishLegalDocument
);
router.get(
  "/legal-acceptances",
  requireSectionAction("AGREEMENTS", "VIEW"),
  adminController.getLegalAcceptances
);
router.get("/email/status", notificationsSend, adminController.getEmailStatus);
router.post(
  "/email/test",
  notificationsSend,
  [body("to").isEmail().withMessage("A valid recipient email is required.")],
  sanitizeInput,
  validateRequest,
  adminController.sendTestEmail
);
router.post(
  "/email/welcome-preview",
  notificationsSend,
  [body("to").isEmail().withMessage("A valid recipient email is required."), body("name").optional().isString()],
  sanitizeInput,
  validateRequest,
  adminController.sendWelcomePreviewEmail
);
router.post(
  "/email/welcome-broadcast",
  notificationsSend,
  [body("audience").optional().isIn(["ALL", "USERS", "PARTNERS"])],
  sanitizeInput,
  validateRequest,
  adminController.broadcastWelcomeEmail
);
router.post(
  "/email/broadcast",
  notificationsSend,
  [
    body("subject").isString().trim().isLength({ min: 1, max: 120 }).withMessage("Subject is required (max 120 chars)."),
    body("body").isString().trim().isLength({ min: 1, max: 5000 }).withMessage("Message body is required (max 5000 chars)."),
  ],
  sanitizeInput,
  validateRequest,
  adminController.broadcastEmail
);
router.post("/withdrawals/:id/approve", requireSectionAction("WITHDRAWALS", "APPROVE"), adminController.approveWithdrawal);
router.post("/withdrawals/:id/approve-with-proof", requireSectionAction("WITHDRAWALS", "APPROVE"), privateUpload.single("proof"), adminController.approveWithdrawalWithProof);
router.post("/withdrawals/:id/reject", requireSectionAction("WITHDRAWALS", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectWithdrawal);
router.get("/reports", reportsManage, adminController.getReports);
router.post("/reports/:id/resolve", requireSectionAction("REPORTS", "APPROVE"), [body("note").optional().isString()], sanitizeInput, validateRequest, adminController.resolveReport);
router.get("/admins", adminMgmtView, adminController.getAdminAccounts);
router.post("/admins", requireSuperAdmin, adminController.createAdminAccount);
router.patch("/admins/:userId", requireSuperAdmin, adminController.updateAdminAccount);
router.post("/admins/:userId/reset-password", requireSuperAdmin, adminController.resetAdminPassword);
router.post("/users/:userId/promote", requireSuperAdmin, [body("role").notEmpty()], sanitizeInput, validateRequest, adminController.promoteUserRole);
router.post("/users/:userId/demote", requireSuperAdmin, adminController.demoteUserRole);
router.get("/audit-logs", auditView, adminController.getAuditLogs);
router.post("/notifications", notificationsSend, [body("userId").notEmpty(), body("title").notEmpty(), body("body").notEmpty()], sanitizeInput, validateRequest, adminController.sendNotification);
router.get("/notifications/inbox", users, adminController.getAdminNotifications);
router.post("/notifications/inbox/:id/read", users, adminController.markAdminNotificationRead);

// Pricing Config
router.get("/pricing", pricingManage, adminController.getPricingConfigs);
router.post("/pricing/simulate", pricingManage, adminController.simulatePricing);
router.get("/bookings/:id/dispatch", bookingsView, adminController.getBookingDispatch);
router.get("/wallets", walletsView, adminController.getWallets);
router.get("/dispatch-board", dispatchView, adminController.getDispatchBoard);
router.get("/communities", communitiesView, communityController.getCommunities);
router.get("/events", eventsView, eventController.getEvents);

// --- Event fee escrow -----------------------------------------------------------
// Money moves here, so every route below requires the REPORTS section at a level
// that can adjudicate a dispute, not merely read it. Settling is irreversible
// from the user's point of view - their money either reaches the organizer or
// goes back to them - so APPROVE is the gate on both the decision and the sweep.
router.get(
  "/event-disputes",
  requireSectionAction("REPORTS", "VIEW"),
  eventEscrowController.listEventDisputes,
);
router.post(
  "/events/:id/settle",
  requireSectionAction("REPORTS", "APPROVE"),
  eventEscrowController.decideEventSettlement,
);
router.post(
  "/events/sweep-escrow",
  requireSectionAction("REPORTS", "APPROVE"),
  eventEscrowController.runEscrowSweep,
);
router.get("/services", revenueView, adminController.getServices);
router.get("/chat-reports", reportsManage, adminController.getChatReports);
router.post("/chat-reports/:id/resolve", reportsManage, adminController.resolveChatReport);
router.get("/bookings/:id/logs", bookingsView, adminController.getBookingLogs);
router.post("/pricing", pricingEdit, [body("key").notEmpty(), body("value").notEmpty()], sanitizeInput, validateRequest, adminController.createPricingConfig);
router.put("/pricing/:id", pricingEdit, adminController.updatePricingConfig);
router.delete("/pricing/:id", pricingEdit, adminController.deletePricingConfig);

// Coupons
router.get("/coupons", couponsManage, adminController.getCoupons);
router.post("/coupons", couponsEdit, [body("code").notEmpty(), body("discountType").isIn(["PERCENTAGE", "FIXED"]), body("discountValue").isFloat({ gt: 0 }), body("validFrom").notEmpty(), body("validTo").notEmpty()], sanitizeInput, validateRequest, adminController.createCoupon);
router.put("/coupons/:id", couponsEdit, adminController.updateCoupon);
router.delete("/coupons/:id", couponsEdit, adminController.deleteCoupon);

// Service Areas (System Settings)
router.get("/service-areas", areasManage, adminController.getServiceAreas);
router.post("/service-areas", areasEdit, [body("name").notEmpty(), body("city").notEmpty()], sanitizeInput, validateRequest, adminController.createServiceArea);
router.put("/service-areas/:id", areasEdit, adminController.updateServiceArea);
router.delete("/service-areas/:id", areasEdit, adminController.deleteServiceArea);

// Campaigns (Offers)
router.get("/campaigns", campaignsManage, adminController.getCampaigns);
router.post("/campaigns", requireSectionAction("OFFERS", "EDIT"), [body("name").notEmpty(), body("discountType").isIn(["PERCENTAGE", "FIXED"]), body("discountValue").isFloat({ gt: 0 }), body("startDate").notEmpty(), body("endDate").notEmpty()], sanitizeInput, validateRequest, adminController.createCampaign);
router.put("/campaigns/:id", requireSectionAction("OFFERS", "EDIT"), adminController.updateCampaign);
router.delete("/campaigns/:id", requireSectionAction("OFFERS", "DELETE"), adminController.deleteCampaign);

// Revenue & Analytics
router.get("/payments", paymentsView, adminController.getPayments);
router.get("/payments/stats", paymentsView, adminController.getPaymentStats);
router.get("/revenue", revenueView, adminController.getRevenueAnalytics);
router.get("/partner-levels", revenueView, adminController.getPartnerLevels);

// Subscriptions & pricing. Prices are the source of truth for the paywall,
// so PRICING.EDIT is required to change anything a customer would see.
const subPlansView = requireSectionAction("PRICING", "VIEW");
const subPlansCreate = requireSectionAction("PRICING", "CREATE");

router.get("/subscriptions/summary", subPlansView, adminSubscriptionController.subscriptionSummary);
router.get("/subscriptions/plans", subPlansView, adminSubscriptionController.listPlans);
router.post("/subscriptions/plans", subPlansCreate, adminSubscriptionController.createPlan);
router.post("/subscriptions/plans/:code", pricingEdit, adminSubscriptionController.updatePlan);
router.post("/subscriptions/plans/:code/toggle", pricingEdit, adminSubscriptionController.togglePlan);

// Free trial. Read is PRICING VIEW; every write is PRICING EDIT, the same tier
// that moves plan prices, because changing the trial length grants real access
// and a narrower tier would let a read-only admin hand out paid access.
router.get("/subscriptions/trial", subPlansView, adminSubscriptionController.getTrialConfig);
router.post("/subscriptions/trial", pricingEdit, [body("days").isInt({ min: 1, max: 365 })], sanitizeInput, validateRequest, adminSubscriptionController.updateTrialConfig);
// grant-all carries no day validator on the body because it may also be sent
// without one, in which case the service applies the currently configured
// length. Validating an optional field as required would reject the common case.
router.post("/subscriptions/trial/grant-all", pricingEdit, [body("days").optional().isInt({ min: 1, max: 365 })], sanitizeInput, validateRequest, adminSubscriptionController.grantTrialToAll);
// days is nullable on purpose: null is how an admin revokes access for one
// account. express-validator's isInt rejects null, so the check is done in the
// controller where null and absent can be told apart.
router.post("/subscriptions/trial/users/:id", pricingEdit, sanitizeInput, validateRequest, adminSubscriptionController.setUserTrial);

export default router;




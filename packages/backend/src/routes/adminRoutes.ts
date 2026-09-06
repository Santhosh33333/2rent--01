import { Router } from "express";
import { body } from "express-validator";
import { authRateLimiter } from "../middleware/rateLimiter";
import { authenticateToken, requireAdmin, requireSuperAdmin } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import { requireSectionAction } from "../rbac/permissions";
import * as adminController from "../controllers/adminController";
import * as communityController from "../controllers/communityController";
import * as eventController from "../controllers/eventController";

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

// Section/action permission guards — backend-enforced (never trust the UI).
const users = requireSectionAction("USERS", "VIEW");
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
router.get("/users", users, adminController.getUsers);
router.get("/users/:id", users, adminController.getUserById);
router.put("/users/:id/status", users, [body("status").isIn(["ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"])], validateRequest, adminController.updateUserStatus);
router.post("/users/:id/impersonate", users, adminController.impersonateUser);
router.post(
  "/users/:id/block",
  users,
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
router.post("/users/:id/unblock", users, adminController.unblockUser);
router.delete("/users/:id", requireSuperAdmin, adminController.deleteUser);
router.get("/kyc-queue", kycReview, adminController.getKycQueue);
router.post("/kyc/:id/approve", requireSectionAction("KYC", "APPROVE"), adminController.approveKyc);
router.post("/kyc/:id/reject", requireSectionAction("KYC", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectKyc);
router.get("/walking-partners", partnersManage, adminController.getWalkingPartners);
router.post("/walking-partners/:id/approve", requireSectionAction("PARTNERS", "APPROVE"), adminController.approveWalkingPartner);
router.post("/walking-partners/:id/reject", requireSectionAction("PARTNERS", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectWalkingPartner);
router.post("/walking-partners/:id/suspend", requireSectionAction("PARTNERS", "REJECT"), [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.suspendPartner);
router.post("/walking-partners/:id/reactivate", requireSectionAction("PARTNERS", "APPROVE"), adminController.reactivatePartner);
router.get("/bookings", bookingsView, adminController.getBookings);
router.get("/bookings/:id", bookingsView, adminController.getBookingDetail);
router.get("/withdrawals", withdrawalsManage, adminController.getWithdrawalRequests);
router.post("/withdrawals/:id/approve", requireSectionAction("WITHDRAWALS", "APPROVE"), adminController.approveWithdrawal);
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

// Pricing Config
router.get("/pricing", pricingManage, adminController.getPricingConfigs);
router.post("/pricing/simulate", pricingManage, adminController.simulatePricing);
router.get("/bookings/:id/dispatch", bookingsView, adminController.getBookingDispatch);
router.get("/wallets", walletsView, adminController.getWallets);
router.get("/dispatch-board", dispatchView, adminController.getDispatchBoard);
router.get("/communities", communitiesView, communityController.getCommunities);
router.get("/events", eventsView, eventController.getEvents);
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

export default router;




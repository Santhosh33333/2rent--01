import { Router } from "express";
import { body } from "express-validator";
import { authRateLimiter } from "../middleware/rateLimiter";
import { authenticateToken, requireAdmin, requirePermission, requireSuperAdmin } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as adminController from "../controllers/adminController";
import * as communityController from "../controllers/communityController";
import * as eventController from "../controllers/eventController";

const router = Router();

router.use(authenticateToken);
router.use(requireAdmin);

const users = requirePermission("users.manage");
const kycReview = requirePermission("kyc.review");
const partnersManage = requirePermission("partners.manage");
const bookingsView = requirePermission("bookings.view");
const withdrawalsManage = requirePermission("withdrawals.manage");
const reportsManage = requirePermission("reports.manage");
const auditView = requirePermission("audit.view");
const notificationsSend = requirePermission("notifications.send");
const pricingManage = requirePermission("pricing.manage");
const couponsManage = requirePermission("coupons.manage");
const areasManage = requirePermission("areas.manage");
const campaignsManage = requirePermission("campaigns.manage");
const revenueView = requirePermission("revenue.view");
const paymentsView = requirePermission("payments.view");
const walletsView = requirePermission("wallets.view");
const dispatchView = requirePermission("dispatch.view");
const communitiesView = requirePermission("communities.view");
const eventsView = requirePermission("events.view");

router.get("/dashboard", adminController.getDashboardStats);
router.get("/users", users, adminController.getUsers);
router.get("/users/:id", users, adminController.getUserById);
router.put("/users/:id/status", users, [body("status").isIn(["ACTIVE", "SUSPENDED", "BANNED", "DEACTIVATED"])], validateRequest, adminController.updateUserStatus);
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
router.post("/kyc/:id/approve", kycReview, adminController.approveKyc);
router.post("/kyc/:id/reject", kycReview, [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectKyc);
router.get("/walking-partners", partnersManage, adminController.getWalkingPartners);
router.post("/walking-partners/:id/approve", partnersManage, adminController.approveWalkingPartner);
router.post("/walking-partners/:id/reject", partnersManage, [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectWalkingPartner);
router.get("/bookings", bookingsView, adminController.getBookings);
router.get("/bookings/:id", bookingsView, adminController.getBookingDetail);
router.get("/withdrawals", withdrawalsManage, adminController.getWithdrawalRequests);
router.post("/withdrawals/:id/approve", withdrawalsManage, adminController.approveWithdrawal);
router.post("/withdrawals/:id/reject", withdrawalsManage, [body("reason").optional().isString()], sanitizeInput, validateRequest, adminController.rejectWithdrawal);
router.get("/reports", reportsManage, adminController.getReports);
router.post("/reports/:id/resolve", reportsManage, [body("note").optional().isString()], sanitizeInput, validateRequest, adminController.resolveReport);
router.get("/admins", requireSuperAdmin, adminController.getAdminAccounts);
router.post("/admins", requireSuperAdmin, adminController.createAdminAccount);
router.patch("/admins/:userId", requireSuperAdmin, adminController.updateAdminAccount);
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
router.post("/pricing", pricingManage, [body("key").notEmpty(), body("value").notEmpty()], sanitizeInput, validateRequest, adminController.createPricingConfig);
router.put("/pricing/:id", pricingManage, adminController.updatePricingConfig);
router.delete("/pricing/:id", pricingManage, adminController.deletePricingConfig);

// Coupons
router.get("/coupons", couponsManage, adminController.getCoupons);
router.post("/coupons", couponsManage, [body("code").notEmpty(), body("discountType").isIn(["PERCENTAGE", "FIXED"]), body("discountValue").isFloat({ gt: 0 }), body("validFrom").notEmpty(), body("validTo").notEmpty()], sanitizeInput, validateRequest, adminController.createCoupon);
router.put("/coupons/:id", couponsManage, adminController.updateCoupon);
router.delete("/coupons/:id", couponsManage, adminController.deleteCoupon);

// Service Areas
router.get("/service-areas", areasManage, adminController.getServiceAreas);
router.post("/service-areas", areasManage, [body("name").notEmpty(), body("city").notEmpty()], sanitizeInput, validateRequest, adminController.createServiceArea);
router.put("/service-areas/:id", areasManage, adminController.updateServiceArea);
router.delete("/service-areas/:id", areasManage, adminController.deleteServiceArea);

// Campaigns
router.get("/campaigns", campaignsManage, adminController.getCampaigns);
router.post("/campaigns", campaignsManage, [body("name").notEmpty(), body("discountType").isIn(["PERCENTAGE", "FIXED"]), body("discountValue").isFloat({ gt: 0 }), body("startDate").notEmpty(), body("endDate").notEmpty()], sanitizeInput, validateRequest, adminController.createCampaign);
router.put("/campaigns/:id", campaignsManage, adminController.updateCampaign);
router.delete("/campaigns/:id", campaignsManage, adminController.deleteCampaign);

// Revenue & Analytics
router.get("/payments", paymentsView, adminController.getPayments);
router.get("/payments/stats", paymentsView, adminController.getPaymentStats);
router.get("/revenue", revenueView, adminController.getRevenueAnalytics);
router.get("/partner-levels", revenueView, adminController.getPartnerLevels);

export default router;




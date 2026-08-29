import { Router } from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import * as appContentController from "../controllers/appContentController";

const router = Router();
router.use(authenticateToken);

// Public content (any authenticated user)
router.get("/banners", appContentController.getBanners);
router.get("/public-settings", appContentController.getPublicSettings);
router.get("/articles", appContentController.getContentArticles);
router.get("/articles/:slug", appContentController.getContentArticleBySlug);

// Admin only
router.post("/banners", requireAdmin, appContentController.createBanner);
router.put("/banners/:id", requireAdmin, appContentController.updateBanner);
router.delete("/banners/:id", requireAdmin, appContentController.deleteBanner);
router.get("/app-settings", requireAdmin, appContentController.getAppSettings);
router.put("/app-settings", requireAdmin, appContentController.updateAppSetting);
router.get("/feature-flags", requireAdmin, appContentController.getFeatureFlags);
router.post("/feature-flags", requireAdmin, appContentController.createFeatureFlag);
router.put("/feature-flags/:id", requireAdmin, appContentController.updateFeatureFlag);

export default router;

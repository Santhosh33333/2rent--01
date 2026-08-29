import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

// ============================================================================
// BANNERS
// ============================================================================

export async function getBanners(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const banners = await prisma.banner.findMany({
      where: { isActive: true, OR: [{ startDate: null }, { startDate: { lte: now } }], AND: [{ OR: [{ endDate: null }, { endDate: { gte: now } }] }] },
      orderBy: { priority: "asc" },
    });
    sendSuccess(res, banners, "Banners retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve banners.", 500, "INTERNAL_ERROR");
  }
}

export async function createBanner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { title, subtitle, imageUrl, linkUrl, position, targetAudience, startDate, endDate, priority } = req.body;
    const banner = await prisma.banner.create({
      data: { title, subtitle, imageUrl, linkUrl, position, targetAudience, startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null, priority: priority || 0 },
    });
    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "BANNER_CREATE", entityType: "Banner", entityId: banner.id } });
    sendSuccess(res, banner, "Banner created.", 201);
  } catch (err) {
    sendError(res, "Failed to create banner.", 500, "INTERNAL_ERROR");
  }
}

export async function updateBanner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const data: any = {};
    const fields = ["title", "subtitle", "imageUrl", "linkUrl", "position", "targetAudience", "isActive", "priority"];
    for (const f of fields) { if (req.body[f] !== undefined) data[f] = req.body[f]; }
    if (req.body.startDate !== undefined) data.startDate = new Date(req.body.startDate);
    if (req.body.endDate !== undefined) data.endDate = new Date(req.body.endDate);
    const banner = await prisma.banner.update({ where: { id }, data });
    sendSuccess(res, banner, "Banner updated.");
  } catch (err) {
    sendError(res, "Failed to update banner.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteBanner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.banner.delete({ where: { id } });
    sendSuccess(res, undefined, "Banner deleted.");
  } catch (err) {
    sendError(res, "Failed to delete banner.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// APP SETTINGS (Admin configurable)
// ============================================================================

export async function getAppSettings(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const settings = await prisma.appSettings.findMany({ orderBy: { category: "asc" } });
    sendSuccess(res, settings, "App settings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve app settings.", 500, "INTERNAL_ERROR");
  }
}

export async function updateAppSetting(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { key, value, description, category, dataType, isPublic } = req.body;
    const setting = await prisma.appSettings.upsert({
      where: { key },
      update: { value, description, category, dataType, isPublic, updatedBy: req.user!.userId },
      create: { key, value, description: description || "", category: category || "GENERAL", dataType: dataType || "STRING", isPublic: isPublic || false, updatedBy: req.user!.userId },
    });
    await prisma.auditLog.create({ data: { actorId: req.user!.userId, actorType: "ADMIN", action: "APP_SETTING_UPDATE", entityType: "AppSettings", entityId: setting.id, metadata: JSON.stringify({ key, value }) } });
    sendSuccess(res, setting, "App setting updated.");
  } catch (err) {
    sendError(res, "Failed to update app setting.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// FEATURE FLAGS
// ============================================================================

export async function getFeatureFlags(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const flags = await prisma.featureFlag.findMany({ orderBy: { name: "asc" } });
    sendSuccess(res, flags, "Feature flags retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve feature flags.", 500, "INTERNAL_ERROR");
  }
}

export async function updateFeatureFlag(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { isEnabled, rolloutPercentage, name, description } = req.body;
    const data: any = {};
    if (isEnabled !== undefined) data.isEnabled = isEnabled;
    if (rolloutPercentage !== undefined) data.rolloutPercentage = rolloutPercentage;
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    data.updatedBy = req.user!.userId;
    const flag = await prisma.featureFlag.update({ where: { id }, data });
    sendSuccess(res, flag, "Feature flag updated.");
  } catch (err) {
    sendError(res, "Failed to update feature flag.", 500, "INTERNAL_ERROR");
  }
}

export async function createFeatureFlag(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { key, name, description, isEnabled, rolloutPercentage } = req.body;
    const flag = await prisma.featureFlag.create({
      data: { key, name, description: description || "", isEnabled: isEnabled ?? false, rolloutPercentage: rolloutPercentage ?? 100, updatedBy: req.user!.userId },
    });
    sendSuccess(res, flag, "Feature flag created.", 201);
  } catch (err) {
    sendError(res, "Failed to create feature flag.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// PUBLIC CONTENT
// ============================================================================

export async function getPublicSettings(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const settings = await prisma.appSettings.findMany({ where: { isPublic: true } });
    const obj: Record<string, string> = {};
    for (const s of settings) obj[s.key] = s.value;
    sendSuccess(res, obj, "Public settings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve public settings.", 500, "INTERNAL_ERROR");
  }
}

export async function getContentArticles(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { type } = req.query;
    const where: any = { isPublished: true };
    if (type) where.type = type;
    const articles = await prisma.contentArticle.findMany({ where, orderBy: { createdAt: "desc" }, select: { id: true, type: true, title: true, slug: true, excerpt: true, updatedAt: true } });
    sendSuccess(res, articles, "Articles retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve articles.", 500, "INTERNAL_ERROR");
  }
}

export async function getContentArticleBySlug(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { slug } = req.params;
    const article = await prisma.contentArticle.findUnique({ where: { slug } });
    if (!article || !article.isPublished) {
      sendError(res, "Article not found.", 404, "NOT_FOUND");
      return;
    }
    await prisma.contentArticle.update({ where: { slug }, data: { viewCount: { increment: 1 } } });
    sendSuccess(res, article, "Article retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve article.", 500, "INTERNAL_ERROR");
  }
}

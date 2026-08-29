import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";

interface UserSettings {
  theme: string;
  fontSize: string;
  language: string;
  notificationsEnabled: boolean;
  chatNotifications: boolean;
  eventReminders: boolean;
  walkingAlerts: boolean;
  communityUpdates: boolean;
  pushEnabled: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  dataSaver: boolean;
  autoDownloadImages: boolean;
  autoDownloadVideos: boolean;
  showOnlineStatus: boolean;
  showLastActive: boolean;
  allowProfileView: boolean;
  allowLocationSharing: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: "system",
  fontSize: "medium",
  language: "en",
  notificationsEnabled: true,
  chatNotifications: true,
  eventReminders: true,
  walkingAlerts: true,
  communityUpdates: true,
  pushEnabled: true,
  emailNotifications: true,
  smsNotifications: false,
  dataSaver: false,
  autoDownloadImages: true,
  autoDownloadVideos: false,
  showOnlineStatus: true,
  showLastActive: true,
  allowProfileView: true,
  allowLocationSharing: false,
};

async function getUserSettings(userId: string): Promise<UserSettings> {
  const entries = await prisma.appSettings.findMany({
    where: { key: { startsWith: `user:${userId}:` } },
  });
  const settings = { ...DEFAULT_SETTINGS };
  for (const entry of entries) {
    const settingKey = entry.key.replace(`user:${userId}:`, "") as keyof UserSettings;
    if (settingKey in settings) {
      (settings as any)[settingKey] = entry.dataType === "BOOLEAN" ? entry.value === "true" : entry.value;
    }
  }
  return settings;
}

export async function getSettings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const settings = await getUserSettings(req.user!.userId);
    sendSuccess(res, settings, "Settings retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve settings.", 500, "INTERNAL_ERROR");
  }
}

export async function updateSettings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const updates = req.body;
    // Whitelist: only accept known setting keys to prevent arbitrary data injection
    const allowedKeys = Object.keys(DEFAULT_SETTINGS);
    const upserts: Promise<any>[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!allowedKeys.includes(key)) continue; // silently skip unknown keys
      const dataType = typeof value === "boolean" ? "BOOLEAN" : "STRING";
      upserts.push(
        prisma.appSettings.upsert({
          where: { key: `user:${userId}:${key}` },
          update: { value: String(value), dataType, updatedBy: userId },
          create: { key: `user:${userId}:${key}`, value: String(value), dataType, category: "USER_SETTINGS", description: `User setting: ${key}`, isPublic: false, updatedBy: userId },
        })
      );
    }
    await Promise.all(upserts);
    const settings = await getUserSettings(userId);
    sendSuccess(res, settings, "Settings updated.");
  } catch (err) {
    sendError(res, "Failed to update settings.", 500, "INTERNAL_ERROR");
  }
}

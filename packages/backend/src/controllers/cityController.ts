import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";

/**
 * SECTION 27 — City management. Super Admin configures per-city services,
 * pricing, partners, service areas, offers, taxes and operating hours.
 * Disabling a city never deletes data (spec section 25).
 */
export async function listCities(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const items = await prisma.city.findMany({ orderBy: { name: "asc" } });
    sendSuccess(res, { items, total: items.length });
  } catch (err) {
    sendError(res, "Failed to retrieve cities.", 500, "INTERNAL_ERROR");
  }
}

export async function createCity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { key, name, state, operatingHours, taxes, config } = req.body as any;
    if (!key || !name) {
      sendError(res, "key and name are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const existing = await prisma.city.findUnique({ where: { key } });
    if (existing) {
      sendError(res, "City key already exists.", 400, "CITY_EXISTS");
      return;
    }
    const city = await prisma.city.create({
      data: {
        key,
        name,
        state: state ?? null,
        operatingHours: operatingHours ? JSON.stringify(operatingHours) : undefined,
        taxes: taxes ? JSON.stringify(taxes) : undefined,
        config: config ? JSON.stringify(config) : undefined,
      },
    });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "CITY_CREATE", section: "SYSTEM_SETTINGS", targetType: "City", targetId: city.id, newValue: { key, name } });
    sendSuccess(res, city, "City created.", 201);
  } catch (err) {
    sendError(res, "Failed to create city.", 500, "INTERNAL_ERROR");
  }
}

export async function updateCity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { name, state, isActive, operatingHours, taxes, config } = req.body as any;
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (state !== undefined) data.state = state;
    if (isActive !== undefined) data.isActive = isActive;
    if (operatingHours !== undefined) data.operatingHours = JSON.stringify(operatingHours);
    if (taxes !== undefined) data.taxes = JSON.stringify(taxes);
    if (config !== undefined) data.config = JSON.stringify(config);
    const city = await prisma.city.update({ where: { id }, data });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "CITY_UPDATE", section: "SYSTEM_SETTINGS", targetType: "City", targetId: id, newValue: data });
    sendSuccess(res, city, "City updated.");
  } catch (err) {
    sendError(res, "Failed to update city.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteCity(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.city.delete({ where: { id } });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "CITY_DELETE", section: "SYSTEM_SETTINGS", targetType: "City", targetId: id });
    sendSuccess(res, undefined, "City deleted.");
  } catch (err) {
    sendError(res, "Failed to delete city.", 500, "INTERNAL_ERROR");
  }
}

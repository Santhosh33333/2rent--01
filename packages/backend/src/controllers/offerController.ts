import { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { auditAdminAction } from "../rbac/audit";

const OFFER_TYPES = [
  "PERCENTAGE_DISCOUNT", "FIXED_AMOUNT_DISCOUNT", "FIRST_BOOKING", "RETURNING_USER",
  "PARTNER_PROMOTION", "SERVICE_SPECIFIC", "TIME_LIMITED", "CITY_SPECIFIC", "REFERRAL", "FESTIVAL",
];

// Allowed state machine (spec section 8):
// DRAFT -> PREVIEW -> ACTIVE ; ACTIVE <-> PAUSED ; ACTIVE -> EXPIRED ; any -> DEACTIVATED
const TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PREVIEW", "DEACTIVATED"],
  PREVIEW: ["ACTIVE", "DRAFT", "DEACTIVATED"],
  ACTIVE: ["PAUSED", "EXPIRED", "DEACTIVATED"],
  PAUSED: ["ACTIVE", "DEACTIVATED"],
  EXPIRED: ["DEACTIVATED"],
  DEACTIVATED: ["DRAFT"],
};

export async function listOffers(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const where: any = {};
    if (_req.query.status) where.status = _req.query.status;
    if (_req.query.type) where.type = _req.query.type;
    const items = await prisma.offer.findMany({ where, orderBy: { createdAt: "desc" } });
    sendSuccess(res, { items, total: items.length });
  } catch (err) {
    sendError(res, "Failed to retrieve offers.", 500, "INTERNAL_ERROR");
  }
}

export async function getOffer(_req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = _req.params;
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) {
      sendError(res, "Offer not found.", 404, "NOT_FOUND");
      return;
    }
    sendSuccess(res, offer);
  } catch (err) {
    sendError(res, "Failed to retrieve offer.", 500, "INTERNAL_ERROR");
  }
}

export async function createOffer(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const {
      code, title, description, type, discountType, discountValue,
      startDate, endDate, maxUses, perUserLimit, minBooking, maxDiscount,
      serviceType, accountType, city,
    } = req.body as any;
    if (!code || !title || !type) {
      sendError(res, "code, title and type are required.", 400, "VALIDATION_ERROR");
      return;
    }
    if (!OFFER_TYPES.includes(type)) {
      sendError(res, `Invalid offer type.`, 400, "INVALID_TYPE");
      return;
    }
    const existing = await prisma.offer.findUnique({ where: { code } });
    if (existing) {
      sendError(res, "Offer code already exists.", 400, "OFFER_EXISTS");
      return;
    }
    const offer = await prisma.offer.create({
      data: {
        code,
        title,
        description,
        type,
        discountType: discountType ?? "PERCENTAGE",
        discountValue: Number(discountValue) || 0,
        status: "DRAFT",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        maxUses: maxUses ?? null,
        perUserLimit: perUserLimit ?? 1,
        minBooking: Number(minBooking) || 0,
        maxDiscount: maxDiscount ?? null,
        serviceType: serviceType ?? null,
        accountType: accountType ?? null,
        city: city ?? null,
        createdBy: req.user!.userId,
      },
    });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "OFFER_CREATE", section: "OFFERS", targetType: "Offer", targetId: offer.id, newValue: { code, type } });
    sendSuccess(res, offer, "Offer created as DRAFT.", 201);
  } catch (err) {
    sendError(res, "Failed to create offer.", 500, "INTERNAL_ERROR");
  }
}

export async function updateOffer(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) {
      sendError(res, "Offer not found.", 404, "NOT_FOUND");
      return;
    }
    if (!["DRAFT", "PREVIEW", "PAUSED"].includes(offer.status)) {
      sendError(res, "Only DRAFT/PREVIEW/PAUSED offers can be edited.", 400, "INVALID_STATE");
      return;
    }
    const editable = ["title", "description", "discountType", "discountValue", "startDate", "endDate", "maxUses", "perUserLimit", "minBooking", "maxDiscount", "serviceType", "accountType", "city"];
    const data: any = {};
    for (const k of editable) {
      if (req.body[k] !== undefined) {
        if (k === "startDate" || k === "endDate") data[k] = new Date(req.body[k]);
        else if (["discountValue", "minBooking", "maxDiscount"].includes(k)) data[k] = Number(req.body[k]);
        else data[k] = req.body[k];
      }
    }
    const updated = await prisma.offer.update({ where: { id }, data });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "OFFER_EDIT", section: "OFFERS", targetType: "Offer", targetId: id, newValue: data });
    sendSuccess(res, updated, "Offer updated.");
  } catch (err) {
    sendError(res, "Failed to update offer.", 500, "INTERNAL_ERROR");
  }
}

/**
 * Lifecycle transition. Approving (ACTIVATE) freezes a snapshot so later edits
 * never change already-confirmed bookings (spec section 8).
 */
export async function setOfferStatus(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { status } = req.body as { status?: string };
    if (!status) {
      sendError(res, "status is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const offer = await prisma.offer.findUnique({ where: { id } });
    if (!offer) {
      sendError(res, "Offer not found.", 404, "NOT_FOUND");
      return;
    }
    if (!TRANSITIONS[offer.status]?.includes(status)) {
      sendError(res, `Cannot move offer from ${offer.status} to ${status}.`, 400, "INVALID_TRANSITION");
      return;
    }
    const data: any = { status };
    if (status === "ACTIVE") {
      // Freeze the immutable snapshot.
      data.snapshot = JSON.stringify({
        code: offer.code,
        title: offer.title,
        type: offer.type,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        minBooking: offer.minBooking,
        maxDiscount: offer.maxDiscount,
        serviceType: offer.serviceType,
        accountType: offer.accountType,
        city: offer.city,
        activatedAt: new Date().toISOString(),
      });
      // Auto-expire by date.
      if (offer.endDate && offer.endDate < new Date()) data.status = "EXPIRED";
    }
    const updated = await prisma.offer.update({ where: { id }, data });
    const actionMap: Record<string, string> = {
      PREVIEW: "OFFER_PREVIEW", ACTIVE: "OFFER_ACTIVATE", PAUSED: "OFFER_PAUSE",
      EXPIRED: "OFFER_EXPIRE", DEACTIVATED: "OFFER_DEACTIVATE",
    };
    await auditAdminAction({ req, actorId: req.user!.userId, action: actionMap[status] ?? "OFFER_STATUS", section: "OFFERS", targetType: "Offer", targetId: id, newValue: { status: data.status } });
    sendSuccess(res, updated, `Offer ${data.status.toLowerCase()}.`);
  } catch (err) {
    sendError(res, "Failed to update offer status.", 500, "INTERNAL_ERROR");
  }
}

export async function deleteOffer(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    await prisma.offer.delete({ where: { id } });
    await auditAdminAction({ req, actorId: req.user!.userId, action: "OFFER_DELETE", section: "OFFERS", targetType: "Offer", targetId: id });
    sendSuccess(res, undefined, "Offer deleted.");
  } catch (err) {
    sendError(res, "Failed to delete offer.", 500, "INTERNAL_ERROR");
  }
}

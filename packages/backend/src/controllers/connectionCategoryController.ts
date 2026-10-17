import { Request, Response } from "express";
import { sendSuccess, sendError } from "../utils/response";
import * as connectionCategoryService from "../services/connectionCategoryService";
import type { CategoryInput } from "../services/connectionCategoryService";

/**
 * Live connection categories.
 *
 * The read endpoint is what the connection flow renders before a user picks a
 * mode and price; the admin endpoints are the configuration surface. All
 * pricing rules live in the service, so this layer only shapes requests and
 * maps failures to stable codes.
 */

function readInput(body: Record<string, unknown>): CategoryInput {
  return {
    key: body.key,
    label: body.label,
    description: body.description,
    chatEnabled: body.chatEnabled,
    callEnabled: body.callEnabled,
    videoEnabled: body.videoEnabled,
    isPaid: body.isPaid,
    chatPricePerMinute: body.chatPricePerMinute,
    callPricePerMinute: body.callPricePerMinute,
    videoPricePerMinute: body.videoPricePerMinute,
    enabled: body.enabled,
    sortOrder: body.sortOrder,
  };
}

/** GET /api/connection-categories — enabled categories for the client. */
export async function getConnectionCategories(_req: Request, res: Response): Promise<Response> {
  try {
    const { items, source } = await connectionCategoryService.listPublic();
    return sendSuccess(res, { items, source }, "Connection categories retrieved.");
  } catch {
    return sendError(res, "Failed to retrieve connection categories.", 500, "INTERNAL_ERROR");
  }
}

/** GET /api/admin/connection-categories — every category, enabled or not. */
export async function adminListCategories(_req: Request, res: Response): Promise<Response> {
  try {
    const { items, source } = await connectionCategoryService.listAll();
    return sendSuccess(res, { items, source }, "Connection categories retrieved.");
  } catch {
    return sendError(res, "Failed to retrieve connection categories.", 500, "INTERNAL_ERROR");
  }
}

/**
 * POST /api/admin/connection-categories/seed — materialise the built-in
 * defaults as editable rows. Idempotent; existing rows are left untouched.
 */
export async function adminSeedCategories(_req: Request, res: Response): Promise<Response> {
  try {
    const result = await connectionCategoryService.seedDefaults();
    return sendSuccess(res, result, `Seeded ${result.created} categories.`);
  } catch {
    return sendError(res, "Failed to seed connection categories.", 500, "INTERNAL_ERROR");
  }
}

export async function adminCreateCategory(req: Request, res: Response): Promise<Response> {
  const input = readInput(req.body ?? {});
  if (!input.key || !input.label) {
    return sendError(res, "key and label are required.", 400, "VALIDATION_ERROR");
  }
  try {
    const category = await connectionCategoryService.createCategory(input);
    return sendSuccess(res, category, "Category created.", 201);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return sendError(res, "A category with that key already exists.", 409, "CONFLICT");
    }
    return sendError(res, "Failed to create category.", 500, "INTERNAL_ERROR");
  }
}

export async function adminUpdateCategory(req: Request, res: Response): Promise<Response> {
  try {
    const category = await connectionCategoryService.updateCategory(req.params.id, readInput(req.body ?? {}));
    if (!category) return sendError(res, "Category not found.", 404, "NOT_FOUND");
    return sendSuccess(res, category, "Category updated.");
  } catch (err) {
    if (isUniqueViolation(err)) {
      return sendError(res, "A category with that key already exists.", 409, "CONFLICT");
    }
    return sendError(res, "Failed to update category.", 500, "INTERNAL_ERROR");
  }
}

export async function adminDeleteCategory(req: Request, res: Response): Promise<Response> {
  try {
    const deleted = await connectionCategoryService.deleteCategory(req.params.id);
    if (!deleted) return sendError(res, "Category not found.", 404, "NOT_FOUND");
    return sendSuccess(res, undefined, "Category deleted.");
  } catch {
    return sendError(res, "Failed to delete category.", 500, "INTERNAL_ERROR");
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

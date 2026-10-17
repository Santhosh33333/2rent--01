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
  // `isPaid` is deliberately absent: the service derives it from the prices so
  // the stored flag can never disagree with what is actually charged.
  return {
    key: body.key,
    label: body.label,
    description: body.description,
    chatEnabled: body.chatEnabled,
    callEnabled: body.callEnabled,
    videoEnabled: body.videoEnabled,
    chatPricePerMinute: body.chatPricePerMinute,
    callPricePerMinute: body.callPricePerMinute,
    videoPricePerMinute: body.videoPricePerMinute,
    enabled: body.enabled,
    sortOrder: body.sortOrder,
  };
}

const KEY_PATTERN = /^[A-Z0-9_]{2,40}$/;
const LABEL_MAX = 60;
const DESCRIPTION_MAX = 200;

function normalizedKey(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function descriptionProblem(input: CategoryInput): string | null {
  if (typeof input.description === "string" && input.description.length > DESCRIPTION_MAX) {
    return `description must be at most ${DESCRIPTION_MAX} characters.`;
  }
  return null;
}

/**
 * A create writes a permanent key, so key and label are checked before the row
 * exists. Updates only send the fields the caller changed, so only those are
 * checked — a PATCH that never mentions `label` cannot fail on it.
 */
function createProblem(input: CategoryInput): string | null {
  if (!KEY_PATTERN.test(normalizedKey(input.key))) {
    return "key must be 2-40 characters using A-Z, 0-9 and _.";
  }
  const label = typeof input.label === "string" ? input.label.trim() : "";
  if (!label || label.length > LABEL_MAX) {
    return `label is required (up to ${LABEL_MAX} characters).`;
  }
  return descriptionProblem(input);
}

function patchProblem(input: CategoryInput): string | null {
  if (input.key !== undefined && !KEY_PATTERN.test(normalizedKey(input.key))) {
    return "key must be 2-40 characters using A-Z, 0-9 and _.";
  }
  if (input.label !== undefined) {
    const label = typeof input.label === "string" ? input.label.trim() : "";
    if (!label || label.length > LABEL_MAX) {
      return `label is required (up to ${LABEL_MAX} characters).`;
    }
  }
  return descriptionProblem(input);
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
  const problem = createProblem(input);
  if (problem) return sendError(res, problem, 400, "VALIDATION_ERROR");
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
  const input = readInput(req.body ?? {});
  const problem = patchProblem(input);
  if (problem) return sendError(res, problem, 400, "VALIDATION_ERROR");
  try {
    const category = await connectionCategoryService.updateCategory(req.params.id, input);
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

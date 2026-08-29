import { Response } from "express";
import { ApiResponse } from "../types";

export function sendSuccess<T>(res: Response, data?: T, message?: string, statusCode = 200): Response {
  const body: ApiResponse<T> = { success: true, data };
  if (message) body.message = message;
  return res.status(statusCode).json(body);
}

export function sendError(res: Response, message: string, statusCode = 400, error?: string): Response {
  const body: ApiResponse = { success: false, message, error };
  return res.status(statusCode).json(body);
}

export function sendPaginated<T>(
  res: Response,
  data: T[],
  meta: { page: number; limit: number; total: number },
  message?: string,
  statusCode = 200
): Response {
  const totalPages = Math.ceil(meta.total / meta.limit) || 0;
  return res.status(statusCode).json({
    success: true,
    data,
    message,
    meta: {
      page: meta.page,
      limit: meta.limit,
      total: meta.total,
      totalPages,
      hasNext: meta.page < totalPages,
      hasPrev: meta.page > 1,
    },
  });
}

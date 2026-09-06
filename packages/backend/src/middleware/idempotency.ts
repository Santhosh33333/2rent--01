import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface IdempotentRequest extends Request {
  idempotencyKey?: string;
}

/**
 * Middleware that enforces idempotency for POST/PUT/PATCH requests.
 * Reads the `X-Idempotency-Key` header. If a key already exists in the
 * database, returns the cached response instead of re-executing the handler.
 * Otherwise, wraps `res.json` to capture and persist the response.
 */
export function idempotencyMiddleware(req: IdempotentRequest, res: Response, next: NextFunction) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const key = req.headers['x-idempotency-key'] as string | undefined;
  if (!key || key.trim() === '') {
    return next();
  }

  req.idempotencyKey = key;

  prisma.idempotencyKey.findUnique({ where: { key } })
    .then((existing) => {
      if (existing) {
        // Return cached response
        res.status(existing.statusCode ?? 200).json(existing.responseBody);
        return;
      }

      // Intercept res.json to capture the response
      const originalJson = res.json.bind(res);
      res.json = ((body: any) => {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const userId = (req as any).userId as string | undefined;
          prisma.idempotencyKey.create({
            data: {
              key,
              userId: userId ?? null,
              requestBody: req.body ?? undefined,
              responseBody: body,
              statusCode: res.statusCode,
              expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
            },
          }).catch(() => { /* best-effort persistence */ });
        }
        return originalJson(body);
      }) as any;

      next();
    })
    .catch(() => {
      // If DB is down, proceed without idempotency
      next();
    });
}

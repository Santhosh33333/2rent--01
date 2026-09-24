import type { Request, Response } from "express";

/**
 * Public endpoint the Android app calls when it crashes at startup. Keeps the
 * report out of the way of normal app logging and sized for small payloads.
 */
export function reportAppCrash(req: Request, res: Response) {
  const { trace, model, androidVersion, appVersion, packageName } =
    (req.body ?? {}) as {
      trace?: string;
      model?: string;
      androidVersion?: string;
      appVersion?: string;
      packageName?: string;
    };

  const safeTrace = String(trace ?? "").slice(0, 4000);
  if (!safeTrace) {
    res.status(400).json({ ok: false, reason: "empty trace" });
    return;
  }

  // Logged so it shows up in Render logs; includes device info for triage.
  console.error(
    `[APP-CRASH] pkg=${packageName ?? "-"} app=${appVersion ?? "-"} device=${model ?? "-"} android=${androidVersion ?? "-"}\n${safeTrace}`
  );

  res.json({ ok: true });
}
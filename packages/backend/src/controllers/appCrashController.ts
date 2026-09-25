import type { Request, Response } from "express";

interface CrashEntry {
  at: string;
  model?: string;
  androidVersion?: string;
  appVersion?: string;
  packageName?: string;
  trace: string;
}

// Small in-memory ring buffer so a crash report can be read back without
// touching the DB (ephemeral across redeploys, which is fine for triage).
const recent: CrashEntry[] = [];
const MAX_REPORTS = 20;

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

  recent.push({
    at: new Date().toISOString(),
    model: model ? String(model).slice(0, 60) : undefined,
    androidVersion: androidVersion ? String(androidVersion).slice(0, 20) : undefined,
    appVersion: appVersion ? String(appVersion).slice(0, 20) : undefined,
    packageName: packageName ? String(packageName).slice(0, 40) : undefined,
    trace: safeTrace,
  });
  if (recent.length > MAX_REPORTS) recent.shift();

  // Logged so it shows up in Render logs; includes device info for triage.
  console.error(
    `[APP-CRASH] pkg=${packageName ?? "-"} app=${appVersion ?? "-"} device=${model ?? "-"} android=${androidVersion ?? "-"}\n${safeTrace}`
  );

  res.json({ ok: true });
}

/** Read back recent reports for triage. */
export function listAppCrashReports(_req: Request, res: Response) {
  res.json({ ok: true, count: recent.length, reports: recent });
}
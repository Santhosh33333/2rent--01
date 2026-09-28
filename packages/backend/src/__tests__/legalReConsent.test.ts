// The re-consent rules are the difference between a fair notice and an
// indefensible one, so they are asserted directly rather than inferred from the
// controller: nobody is blocked before they were told, nobody is blocked before
// their window lapsed, and consent is never invented on their behalf.
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';

const DAY = 24 * 60 * 60 * 1000;

const state = {
  // Kinds accepted at the CURRENT version, per user.
  accepted: new Map<string, string[]>(),
  notices: new Map<string, { userId: string; notifiedAt: Date; graceDays: number; reminders: number; lastRemindedAt: Date | null; satisfiedAt: Date | null }>(),
  emails: [] as string[],
};

const CURRENT = 1;
const KINDS = ["USER_AGREEMENT", "PRIVACY_POLICY", "COMMUNITY_GUIDELINES"];

vi.mock("../config/database", () => ({
  prisma: {
    legalDocument: {
      findMany: vi.fn(async ({ where }: any) =>
        KINDS.filter((k) => where.kind.in.includes(k)).map((kind) => ({
          id: `doc-${kind}`,
          kind,
          version: CURRENT,
          title: kind,
        }))
      ),
    },
    legalAcceptance: {
      findMany: vi.fn(async ({ where }: any) => {
        const kinds = state.accepted.get(where.userId) || [];
        return kinds
          .filter((k) => where.kind.in.includes(k))
          .map((kind) => ({ kind, version: 1, acceptedAt: new Date() }));
      }),
    },
    legalReConsent: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const existing = state.notices.get(where.userId);
        if (existing) return existing;
        const row = {
          userId: create.userId,
          notifiedAt: new Date(),
          graceDays: create.graceDays,
          reminders: 0,
          lastRemindedAt: null,
          satisfiedAt: null,
        };
        state.notices.set(row.userId, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = state.notices.get(where.userId)!;
        if (data.lastRemindedAt) row.lastRemindedAt = data.lastRemindedAt as Date;
        if (data.reminders) row.reminders += data.reminders.increment as number;
        return row;
      }),
      updateMany: vi.fn(async ({ where }: any) => {
        const row = state.notices.get(where.userId);
        if (row && !row.satisfiedAt) row.satisfiedAt = new Date();
        return { count: row ? 1 : 0 };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const r = state.notices.get(where.userId);
        return r ? { lastRemindedAt: r.lastRemindedAt, reminders: r.reminders } : null;
      }),
      findMany: vi.fn(async () => Array.from(state.notices.values()).filter((n) => !n.satisfiedAt)),
    },
    user: {
      findUnique: vi.fn(async ({ where }: any) =>
        where.id.startsWith("blocked-") ? null : { email: "u@test.com", fullName: "Test User" }
      ),
      count: vi.fn(async () => state.accepted.size + state.notices.size),
    },
  },
}));

vi.mock("../config/env", () => ({ env: { LEGAL_RECONSENT_GRACE_DAYS: 30, ADMIN_EMAIL: "admin@test.com" } }));
vi.mock("../services/emailService", () => ({
  sendEmail: vi.fn(async (to: string) => {
    state.emails.push(to);
    return { ok: true };
  }),
}));
vi.mock("../services/emailTemplate", () => ({
  renderEmail: vi.fn(() => "<html/>"),
  escHtml: (s: string) => s,
  WEB_ORIGIN: "https://nabri.test",
}));

let svc: typeof import("../services/legalReConsentService");

beforeAll(async () => {
  svc = await import("../services/legalReConsentService.js");
});

beforeEach(() => {
  state.accepted.clear();
  state.notices.clear();
  state.emails = [];
});

describe("legal re-consent", () => {
  it("requires a signature for an account that never accepted", async () => {
    const s = await svc.getReConsentState("legacy-1");
    expect(s.required).toBe(true);
    expect(s.satisfied).toBe(false);
    expect(s.missing.sort()).toEqual([...KINDS].sort());
  });

  it("starts the clock at notification, not at deploy", async () => {
    const s = await svc.getReConsentState("legacy-2");
    expect(s.notifiedAt).not.toBeNull();
    // The window is a full one from now, not already partly spent.
    expect(s.daysRemaining).toBe(30);
    expect(s.graceExpired).toBe(false);
  });

  it("does not block inside the grace window", async () => {
    const s = await svc.getReConsentState("legacy-3");
    expect(s.blocking).toBe(false);
  });

  it("blocks only after the window actually lapses", async () => {
    const notice = {
      userId: "legacy-4",
      notifiedAt: new Date(Date.now() - 31 * DAY),
      graceDays: 30,
      reminders: 0,
      lastRemindedAt: new Date(),
      satisfiedAt: null,
    };
    state.notices.set("legacy-4", notice);
    const s = await svc.getReConsentState("legacy-4");
    expect(s.graceExpired).toBe(true);
    expect(s.daysRemaining).toBe(0);
    expect(s.blocking).toBe(true);
  });

  it("keeps the window open for someone told one day ago", async () => {
    state.notices.set("legacy-5", {
      userId: "legacy-5",
      notifiedAt: new Date(Date.now() - 1 * DAY),
      graceDays: 30,
      reminders: 0,
      lastRemindedAt: new Date(),
      satisfiedAt: null,
    });
    const s = await svc.getReConsentState("legacy-5");
    expect(s.daysRemaining).toBe(29);
    expect(s.blocking).toBe(false);
  });

  it("never blocks an account that has signed the current versions", async () => {
    state.accepted.set("current-1", [...KINDS]);
    const s = await svc.getReConsentState("current-1");
    expect(s.satisfied).toBe(true);
    expect(s.required).toBe(false);
    expect(s.blocking).toBe(false);
  });

  it("never writes a signature for someone who did not give one", async () => {
    await svc.getReConsentState("legacy-6");
    // The only thing persisted is the notice. No acceptance is ever created.
    expect(state.accepted.has("legacy-6")).toBe(false);
    expect(state.accepted.size).toBe(0);
  });

  it("does not re-send the notice on every request", async () => {
    // The notice is sent fire-and-forget, so let the promise chain settle.
    const flush = () => new Promise((r) => setImmediate(r));
    const first = await svc.getReConsentState("legacy-7");
    await flush();
    expect(state.emails).toHaveLength(1);
    // Already reminded just now: must not send again the same day.
    const notice = state.notices.get("legacy-7")!;
    notice.lastRemindedAt = new Date();
    const second = await svc.getReConsentState("legacy-7");
    await flush();
    expect(state.emails).toHaveLength(1);
    expect(second.notifiedAt).toBe(first.notifiedAt);
  });

  it("reports outstanding accounts for admin reporting", async () => {
    await svc.getReConsentState("legacy-8");
    state.notices.set("legacy-9", {
      userId: "legacy-9",
      notifiedAt: new Date(Date.now() - 40 * DAY),
      graceDays: 30,
      reminders: 1,
      lastRemindedAt: new Date(),
      satisfiedAt: null,
    });
    const counts = await svc.countOutstandingReConsent();
    expect(counts.total).toBeGreaterThanOrEqual(2);
    expect(counts.blocking).toBe(1);
  });
});

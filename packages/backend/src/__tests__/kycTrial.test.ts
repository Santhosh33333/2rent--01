/**
 * KYC trial policy.
 *
 * The trial deliberately relaxes an identity gate, so the tests are mostly about
 * where it stops relaxing. A trial that never expires, or that keeps working one
 * millisecond past its deadline, turns a bounded exception into a permanent hole
 * in KYC - which is the failure nobody would notice until an incident.
 */
import { describe, it, expect } from "vitest";
import {
  evaluateKycGate,
  resolveTrialExpiry,
  MAX_TRIAL_DAYS,
  DEFAULT_TRIAL_DAYS,
} from "../services/kycTrialService";

const now = new Date("2026-10-08T12:00:00.000Z");
const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe("evaluateKycGate: approved users", () => {
  it("lets a VERIFIED user through regardless of any trial", () => {
    expect(evaluateKycGate({ status: "VERIFIED", trialEndsAt: null }, now).allowed).toBe(true);
  });

  it("honours APPROVED, the other terminal state", () => {
    expect(evaluateKycGate({ status: "APPROVED", trialEndsAt: null }, now).allowed).toBe(true);
  });

  it("keeps an approved user approved even after a stale trial lapses", () => {
    const v = { status: "VERIFIED", trialEndsAt: inDays(-3) };
    expect(evaluateKycGate(v, now)).toEqual({ allowed: true, reason: "approved", trialEndsAt: v.trialEndsAt });
  });
});

describe("evaluateKycGate: no verification at all", () => {
  it("blocks, exactly as it did before trials existed", () => {
    expect(evaluateKycGate(null, now)).toEqual({ allowed: false, reason: "missing", trialEndsAt: null });
    expect(evaluateKycGate(undefined, now).allowed).toBe(false);
  });
});

describe("evaluateKycGate: unapproved but in review", () => {
  it.each(["NOT_STARTED", "DRAFT", "SUBMITTED", "PENDING_REVIEW", "UNDER_VERIFICATION", "REJECTED", "RESUBMIT_REQUIRED"])(
    "blocks %s when no trial is set",
    (status) => {
      expect(evaluateKycGate({ status, trialEndsAt: null }, now)).toEqual({
        allowed: false,
        reason: "pending",
        trialEndsAt: null,
      });
    }
  );
});

describe("evaluateKycGate: active trial", () => {
  it("admits a user whose trial is still running", () => {
    const v = { status: "NOT_STARTED", trialEndsAt: inDays(3) };
    expect(evaluateKycGate(v, now)).toEqual({ allowed: true, reason: "trial", trialEndsAt: v.trialEndsAt });
  });

  it("admits a rejected applicant during a trial, since the trial is the point", () => {
    expect(evaluateKycGate({ status: "REJECTED", trialEndsAt: inDays(1) }, now).allowed).toBe(true);
  });

  it("reports a trial as active one second before it ends", () => {
    const v = { status: "NOT_STARTED", trialEndsAt: new Date(now.getTime() + 1000) };
    expect(evaluateKycGate(v, now).allowed).toBe(true);
  });
});

describe("evaluateKycGate: expired trial", () => {
  it("blocks one second after the deadline", () => {
    const v = { status: "NOT_STARTED", trialEndsAt: new Date(now.getTime() - 1000) };
    expect(evaluateKycGate(v, now)).toEqual({ allowed: false, reason: "trial_expired", trialEndsAt: v.trialEndsAt });
  });

  it("blocks at the exact instant the trial ends", () => {
    // Strictly-greater-than on the expiry, not >=. With >= this would still be
    // open at the deadline instant.
    const v = { status: "NOT_STARTED", trialEndsAt: now };
    expect(evaluateKycGate(v, now).allowed).toBe(false);
  });

  it("distinguishes an expired trial from never having had one", () => {
    // The copy differs: an expired trial should tell the user to finish now,
    // a first-time applicant should be walked through it.
    expect(evaluateKycGate({ status: "NOT_STARTED", trialEndsAt: inDays(-1) }, now).reason).toBe("trial_expired");
    expect(evaluateKycGate({ status: "NOT_STARTED", trialEndsAt: null }, now).reason).toBe("pending");
  });

  it("does not resurrect the trial after it lapses", () => {
    const v = { status: "NOT_STARTED", trialEndsAt: inDays(-1) };
    expect(evaluateKycGate(v, new Date(now.getTime() + 86_400_000)).allowed).toBe(false);
  });
});

describe("resolveTrialExpiry", () => {
  it("defaults to a week when no day count is given", () => {
    expect(resolveTrialExpiry(undefined, now).getTime()).toBe(inDays(DEFAULT_TRIAL_DAYS).getTime());
  });

  it("honours an explicit day count", () => {
    expect(resolveTrialExpiry(3, now).getTime()).toBe(inDays(3).getTime());
  });

  it("accepts exactly the maximum", () => {
    expect(() => resolveTrialExpiry(MAX_TRIAL_DAYS, now)).not.toThrow();
  });

  it("refuses to exceed the maximum rather than silently clamping", () => {
    // Clamping would grant something different from what the admin asked for,
    // while looking like it had worked.
    expect(() => resolveTrialExpiry(MAX_TRIAL_DAYS + 1, now)).toThrow(/TRIAL_DAYS_MAX/);
    expect(() => resolveTrialExpiry(9999, now)).toThrow(/TRIAL_DAYS_MAX/);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("refuses an invalid day count: %s", (days) => {
    expect(() => resolveTrialExpiry(days as number, now)).toThrow(/TRIAL_DAYS_INVALID/);
  });

  it("treats an explicit null like an omitted value", () => {
    expect(resolveTrialExpiry(null as unknown as undefined, now).getTime()).toBe(
      inDays(DEFAULT_TRIAL_DAYS).getTime()
    );
  });

  it("produces an expiry strictly in the future", () => {
    const expiry = resolveTrialExpiry(1, now);
    expect(expiry.getTime()).toBeGreaterThan(now.getTime());
  });
});

describe("trial round trip", () => {
  it("granting then evaluating admits the user, and the deadline closes it", () => {
    const granted = resolveTrialExpiry(1, now);
    const v = { status: "NOT_STARTED", trialEndsAt: granted };
    expect(evaluateKycGate(v, now).allowed).toBe(true);
    // One day later plus a millisecond: back under the gate.
    expect(evaluateKycGate(v, new Date(granted.getTime() + 1)).allowed).toBe(false);
  });
});

/**
 * Public origin resolution.
 *
 * These are the rules that decide where a customer is sent after paying. The
 * failure they guard against is silent and expensive: a live return URL built
 * from "http://localhost:5173" completes the payment and then dumps the payer
 * on a dead page, with no error anywhere. So every branch is asserted, including
 * the one that must stay fatal.
 *
 * The environment is stubbed per test rather than mutated, because touching
 * process.env re-runs full environment validation on import.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../config/env", () => ({
  env: { CORS_ORIGIN: "", PUBLIC_WEB_ORIGIN: "", isProduction: false },
}));

import { env } from "../config/env";
import { publicWebOrigin, DEFAULT_PUBLIC_WEB_ORIGIN } from "../config/publicOrigin";

type MutableEnv = { CORS_ORIGIN: string; PUBLIC_WEB_ORIGIN?: string; isProduction: boolean };

function setEnv(next: Partial<MutableEnv>) {
  const target = env as unknown as MutableEnv;
  target.CORS_ORIGIN = next.CORS_ORIGIN ?? "";
  target.PUBLIC_WEB_ORIGIN = next.PUBLIC_WEB_ORIGIN;
  target.isProduction = next.isProduction ?? false;
}

describe("publicWebOrigin", () => {
  beforeEach(() => setEnv({}));
  afterEach(() => setEnv({}));

  it("uses PUBLIC_WEB_ORIGIN when it is set", () => {
    setEnv({ PUBLIC_WEB_ORIGIN: "https://app.example.com" });
    expect(publicWebOrigin()).toBe("https://app.example.com");
  });

  it("falls back to the deployed origin in production when nothing is configured", () => {
    // This is the exact production misconfiguration that produced live payment
    // return URLs pointing at localhost: CORS_ORIGIN was unset on the host.
    setEnv({ isProduction: true, CORS_ORIGIN: "" });
    expect(publicWebOrigin()).toBe(DEFAULT_PUBLIC_WEB_ORIGIN);
  });

  it("ignores the loopback CORS default in production", () => {
    // CORS_ORIGIN defaults to localhost for local dev. In production that
    // default must never win, or a paying customer is redirected to a
    // developer's machine.
    setEnv({ isProduction: true, CORS_ORIGIN: "http://localhost:5173" });
    expect(publicWebOrigin()).toBe(DEFAULT_PUBLIC_WEB_ORIGIN);
  });

  it("prefers a real CORS_ORIGIN over the built-in default in production", () => {
    setEnv({ isProduction: true, CORS_ORIGIN: "https://app.example.com,https://other.example.com" });
    expect(publicWebOrigin()).toBe("https://app.example.com");
  });

  it("strips a trailing slash so joined paths do not double up", () => {
    setEnv({ PUBLIC_WEB_ORIGIN: "https://app.example.com/" });
    expect(publicWebOrigin()).toBe("https://app.example.com");
  });

  it("keeps loopback in development so the local dev server still works", () => {
    setEnv({ isProduction: false, CORS_ORIGIN: "http://localhost:5173" });
    expect(publicWebOrigin()).toBe("http://localhost:5173");
  });

  it("refuses an explicitly configured loopback origin in production", () => {
    // Unlike the absent case, this is a deliberate misconfiguration and is the
    // one thing allowed to be fatal: a silent fallback would hide the mistake.
    setEnv({ isProduction: true, PUBLIC_WEB_ORIGIN: "http://localhost:5173" });
    expect(() => publicWebOrigin()).toThrow(/loopback/i);
  });

  it("refuses a PUBLIC_WEB_ORIGIN that is not an absolute URL", () => {
    setEnv({ PUBLIC_WEB_ORIGIN: "app.example.com" });
    expect(() => publicWebOrigin()).toThrow(/absolute/i);
  });

  it("refuses a non-http scheme", () => {
    setEnv({ PUBLIC_WEB_ORIGIN: "javascript:alert(1)" });
    expect(() => publicWebOrigin()).toThrow(/absolute/i);
  });
});

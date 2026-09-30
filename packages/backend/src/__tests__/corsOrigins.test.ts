/**
 * CORS origin rules.
 *
 * The scenario these exist to prevent is real and already happened: a custom
 * domain (yuvers.in) was served correctly but every API call returned 500,
 * because the origin was not in CORS_ORIGIN. The site looked fine and nothing
 * worked. The predicate below is what decides that, so it is asserted directly
 * rather than only through a booted server.
 */
import { describe, it, expect } from "vitest";
import {
  isLoopbackOrigin,
  isOriginAllowed,
  isVercelOrigin,
  parseAllowedOrigins,
} from "../config/corsOrigins";

describe("parseAllowedOrigins", () => {
  it("reads a comma-separated list and drops blanks", () => {
    expect(parseAllowedOrigins("https://yuvers.in, https://www.yuvers.in ,")).toEqual([
      "https://yuvers.in",
      "https://www.yuvers.in",
    ]);
  });

  it("treats an unset value as no explicit origins", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });

  it("does not drop an origin that merely contains a space", () => {
    expect(parseAllowedOrigins("https://a.example,https://b.example")).toHaveLength(2);
  });
});

describe("isOriginAllowed", () => {
  const allowed = ["https://yuvers.in", "https://www.yuvers.in"];

  it("allows an explicitly configured custom domain", () => {
    expect(isOriginAllowed("https://yuvers.in", allowed)).toBe(true);
  });

  it("denies a custom domain that is not in the list", () => {
    // The exact production failure: yuvers.in is served by Vercel and answers
    // 200 on its own, but was absent from CORS_ORIGIN so every API call 500'd.
    expect(isOriginAllowed("https://typo-yuvers.in", allowed)).toBe(false);
  });

  it("is an exact match, not a suffix or prefix match", () => {
    // Substring matching here would let "https://evil-yuvers.in" through.
    expect(isOriginAllowed("https://evil-yuvers.in", allowed)).toBe(false);
    expect(isOriginAllowed("https://yuvers.in.evil.com", allowed)).toBe(false);
    expect(isOriginAllowed("https://yuvers.in:8080", allowed)).toBe(false);
  });

  it("does not treat http and https as interchangeable", () => {
    // The domain is served over https only; allowing http would admit a
    // downgrade of the whole session.
    expect(isOriginAllowed("http://yuvers.in", allowed)).toBe(false);
  });

  it("allows any vercel preview subdomain so redeploys do not need an env edit", () => {
    expect(isOriginAllowed("https://2rent-01.vercel.app", allowed)).toBe(true);
    expect(isOriginAllowed("https://web-a1b2c3.vercel.app", allowed)).toBe(true);
  });

  it("does not let a lookalike host borrow the vercel wildcard", () => {
    expect(isOriginAllowed("https://notvercel.app", allowed)).toBe(false);
    expect(isOriginAllowed("https://vercel.app.evil.com", allowed)).toBe(false);
  });

  it("allows loopback for the dev server and the Android WebView", () => {
    expect(isOriginAllowed("http://localhost:5173", allowed)).toBe(true);
    expect(isOriginAllowed("https://localhost", allowed)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:3000", allowed)).toBe(true);
  });

  it("allows a caller that sends no Origin at all", () => {
    // curl, mobile native and server-to-server send none. CORS constrains
    // browsers; rejecting these would break non-browser clients for no gain.
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});

describe("isLoopbackOrigin", () => {
  it("does not crash on a non-URL", () => {
    expect(isLoopbackOrigin("not a url")).toBe(false);
    expect(isVercelOrigin("not a url")).toBe(false);
  });
});

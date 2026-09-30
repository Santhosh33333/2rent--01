/**
 * Which request origins the API will answer.
 *
 * Extracted from app.ts so the rule can be tested directly. It matters that
 * this is a pure predicate over a list of strings: the cost of getting it wrong
 * is not a failed request, it is an entire deployed app whose every API call
 * dies with no explanation visible to the user.
 *
 * Two wildcards exist deliberately, and both are safe because neither widens who
 * can reach authenticated endpoints on its own - they still need a valid
 * session. They only exist so redeploys do not require an env edit:
 *   - loopback, for the dev server and the Capacitor Android WebView (which is
 *     https://localhost under androidScheme)
 *   - *.vercel.app, because Vercel mints a fresh web-<hash> subdomain per push
 */

/** Dev server and the Capacitor Android WebView. */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  } catch {
    return false;
  }
}

/** Any Vercel-owned host, including per-deploy preview subdomains. */
export function isVercelOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === "vercel.app" || url.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
}

/**
 * Same-origin and non-browser callers send no Origin header (curl, mobile
 * native, server-to-server). Those are allowed: CORS exists to constrain
 * browsers, and rejecting them would break every non-browser client for no
 * security gain.
 */
export function isOriginAllowed(origin: string | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  return allowedOrigins.includes(origin) || isLoopbackOrigin(origin) || isVercelOrigin(origin);
}

/** Splits the comma-separated CORS_ORIGIN env value. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

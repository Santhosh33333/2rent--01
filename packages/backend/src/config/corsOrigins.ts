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

/**
 * The project's own production web origins, allowed unconditionally.
 *
 * These are not secrets. Hardcoding them removes a failure mode that cost a
 * real outage: CORS_ORIGIN had to be typed into the Render dashboard, and when
 * the site moved to a custom domain the old value kept being served, so every
 * request from the real domain was refused with 403 and the browser reported it
 * only as "Network Error". Declaring the domains next to the code that has to
 * honour them means a domain change is a reviewed commit.
 *
 * CORS_ORIGIN still works and is still additive, for any additional origin such
 * as a staging host. It is no longer load-bearing for the main domains.
 *
 * Apex and www are both listed because they are separate origins to a browser.
 */
export const PROJECT_WEB_ORIGINS: readonly string[] = [
  "https://yuvers.in",
  "https://www.yuvers.in",
];

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
  if (PROJECT_WEB_ORIGINS.includes(origin)) return true;
  return allowedOrigins.includes(origin) || isLoopbackOrigin(origin) || isVercelOrigin(origin);
}

/** Splits the comma-separated CORS_ORIGIN env value. */
export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

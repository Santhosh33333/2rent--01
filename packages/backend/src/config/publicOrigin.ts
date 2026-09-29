/**
 * The app's single public web origin.
 *
 * This matters well beyond CORS: it is what post-payment return URLs are built
 * from, so a wrong value does not produce a visible error, it produces a
 * customer who has paid and been dumped on a broken page. That is exactly what
 * happened here. CORS_ORIGIN was unset on the host, so payment code read it,
 * got the schema default of "http://localhost:5173", and built a live return
 * URL pointing at a developer's machine.
 *
 * Resolution order:
 *   1. PUBLIC_WEB_ORIGIN   - explicit, and the only value allowed to be fatal
 *   2. CORS_ORIGIN         - first entry, used when it is a real origin
 *   3. DEFAULT_PUBLIC_WEB_ORIGIN - the deployed web app
 *
 * An explicitly configured loopback origin is a hard error in production,
 * because that is a deliberate misconfiguration rather than an absent one.
 * A merely absent or loopback-by-default CORS_ORIGIN falls through to the known
 * deployed origin instead of taking payments down with it.
 */
import { env } from "./env"

export const DEFAULT_PUBLIC_WEB_ORIGIN = "https://2rent-01.vercel.app"

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"])

function parseOrigin(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

export function publicWebOrigin(): string {
  const explicit = (env.PUBLIC_WEB_ORIGIN || "").trim()

  if (explicit) {
    const url = parseOrigin(explicit)
    if (!url || !/^https?:$/.test(url.protocol)) {
      throw new Error(
        `PUBLIC_WEB_ORIGIN must be an absolute http(s) origin, got ${JSON.stringify(explicit)}`
      )
    }
    if (env.isProduction && LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `Refusing to use the loopback origin ${url.hostname} for live payment return URLs. ` +
          "Set PUBLIC_WEB_ORIGIN to the deployed web origin."
      )
    }
    return stripTrailingSlash(explicit)
  }

  // CORS_ORIGIN may legitimately be a list for local dev, so only the first
  // entry is ever considered as an origin to send a payer back to.
  const firstCorsOrigin = (env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)[0]

  if (firstCorsOrigin) {
    const url = parseOrigin(firstCorsOrigin)
    if (url && /^https?:$/.test(url.protocol) && !LOOPBACK_HOSTS.has(url.hostname)) {
      return stripTrailingSlash(firstCorsOrigin)
    }
  }

  // Loopback in development is correct; in production the deployed origin is.
  return env.isProduction
    ? DEFAULT_PUBLIC_WEB_ORIGIN
    : stripTrailingSlash(firstCorsOrigin || "http://localhost:5173")
}

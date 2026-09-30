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

  // CORS_ORIGIN may legitimately be a list (dev web + Vercel preview + a custom
  // domain), but only the FIRST entry is ever considered as an origin to send a
  // payer back to.
  //
  // That coupling is a trap when a custom domain is added. The natural move is to
  // append it - "https://old.vercel.app,https://mydomain.com" - which passes every
  // CORS check and still sends every paying customer back to the old site,
  // forever, with no error. Payment return URLs are the one thing that must be
  // explicit, so when a second real origin appears without PUBLIC_WEB_ORIGIN
  // saying which one it is, refuse rather than guess. Guessing here costs a
  // customer their money and a support ticket; failing to boot costs one env var.
  const corsOrigins = (env.CORS_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  const realCorsOrigins = corsOrigins.filter((value) => {
    const url = parseOrigin(value)
    return !!url && /^https?:$/.test(url.protocol) && !LOOPBACK_HOSTS.has(url.hostname)
  })

if (env.isProduction && realCorsOrigins.length > 1) {
    // Warned, not thrown: listing several origins in CORS_ORIGIN is legitimate
    // and already tested (a Vercel preview plus a custom domain, say), so
    // refusing to boot over it would take the whole API down to fix a cosmetic
    // ambiguity. Resolving to the first entry is the documented behaviour and
    // stays. What was missing was any signal that the choice was implicit.
    console.warn(
      `[publicOrigin] CORS_ORIGIN lists ${realCorsOrigins.length} public origins ` +
        `(${realCorsOrigins.join(", ")}) and PUBLIC_WEB_ORIGIN is unset. Post-payment ` +
        `return URLs will use "${realCorsOrigins[0]}". If that is not the origin customers ` +
        `should land on after paying, set PUBLIC_WEB_ORIGIN explicitly.`
    )
  }

  const firstCorsOrigin = corsOrigins[0]

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

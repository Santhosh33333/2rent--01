/**
 * Demo sandbox: a fenced demo user + demo partner pair for live trials.
 *
 * Rules (enforced at every surface):
 * - Demo accounts never appear to real users (discovery, matching,
 *   nearby feeds, AI matches), and real accounts never appear to demo.
 * - The demo user only ever matches the demo partner and vice versa.
 * - Demo wallets are play money: super-admins can refill them, but demo
 *   accounts can NEVER withdraw to real banks/UPI.
 *
 * Identity is by email so no schema change is needed. Defaults work with
 * zero configuration; override via DEMO_USER_EMAIL / DEMO_PARTNER_EMAIL.
 */
import { env } from "../config/env";

export const DEMO_USER_EMAIL = (env.DEMO_USER_EMAIL || "demo.user@sidebud.demo").toLowerCase();
export const DEMO_PARTNER_EMAIL = (env.DEMO_PARTNER_EMAIL || "demo.partner@sidebud.demo").toLowerCase();

export const DEMO_EMAILS = [DEMO_USER_EMAIL, DEMO_PARTNER_EMAIL];

export const DEMO_WALLET_CEILING = 10_000_000; // Rs 1 Cr play money ~ "unlimited"

/**
 * Any address that is obviously a demo/test identity, regardless of domain.
 *
 * The two configured DEMO_* addresses alone were not enough: the sandbox was
 * seeded with `demo.user@rentbuddy.app` / `demo.partner@rentbuddy.app` while
 * the fence only knew the `*.sidebud.demo` defaults, so demo profiles leaked
 * into real users' discovery and matching feeds. Pattern matching closes that
 * hole, so no account that is plainly a demo can ever appear to a real user.
 */
const DEMO_EMAIL_PATTERNS = [
  /^demo[._-]/i,
  /^test[._-]/i,
  /^qa[._-]/i,
  /^e2e[._-]/i,
  /^fresh(user|account|e2e)/i,
  /^rbac-/i,
  /^credit-/i,
  /^upi(test|_)/i,
  /^probe-/i,
  /^blob(test|recv)/i,
  /^referee_/i,
  /@sidebud\.demo$/i,
  /@test\.local$/i,
  /@example\.(com|org|net)$/i,
];

/** True for configured demo addresses OR anything matching a demo/test pattern. */
export function isDemoEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  if (DEMO_EMAILS.includes(e)) return true;
  return DEMO_EMAIL_PATTERNS.some((re) => re.test(e));
}

export function isDemoPartnerEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return e === DEMO_PARTNER_EMAIL || /^demo[._-]?partner/i.test(e);
}

export function isDemoUserEmail(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase().trim();
  return e === DEMO_USER_EMAIL || /^demo[._-]?user/i.test(e);
}

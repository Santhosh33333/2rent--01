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

export function isDemoEmail(email?: string | null): boolean {
  if (!email) return false;
  return DEMO_EMAILS.includes(email.toLowerCase());
}

export function isDemoPartnerEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase() === DEMO_PARTNER_EMAIL;
}

export function isDemoUserEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.toLowerCase() === DEMO_USER_EMAIL;
}

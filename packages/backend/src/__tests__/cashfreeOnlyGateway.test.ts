/**
 * Cashfree is the only payment gateway, and this file makes that stay true.
 *
 * Razorpay was not switched off, it was removed: no route, no service, no
 * columns, no credentials. Each test below pins one of those surfaces, because
 * a half-retired gateway is the worst state to be in. A stale webhook route
 * still verifies nothing but still accepts POSTs, and a leftover column plus a
 * fallback branch is how a settlement gets written twice.
 *
 * These assertions are structural (against source and schema text) rather than
 * behavioural, on purpose: the failure being prevented is a *reintroduction*,
 * and the cheapest reliable signal for that is the shape of the code itself.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");
const readSrc = (p: string) => read(join(SRC, p));
const BACKEND = join(__dirname, "../..");
const REPO = join(BACKEND, "../..");

/** Directories whose contents are not source of the running service. */
const IGNORED = /(^|[\\/])(node_modules|dist|build|coverage|\.git|\.expo|\.kiro|migrations|assets)([\\/]|$)/;

/**
 * Identifiers that would mean a second gateway is still wired in.
 *
 * A prose mention ("Razorpay was removed") is documentation and is allowed; a
 * live env key, column, field, import or enum value is not. Matching the
 * identifiers rather than the word is what makes that distinction enforceable.
 */
const LIVE_REFERENCE =
  /RAZORPAY_|razorpayOrderId|razorpayPaymentId|razorpaySignature|razorpayRefundId|razorpay_order_id|razorpay_payment_id|razorpay_signature|react-native-razorpay|from\s+["']razorpay["']|require\(\s*["']razorpay["']\s*\)|["']razorpay["']/;

/** Drops comments so a sentence about the removal is not read as a reference. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!IGNORED.test(`${entry.name}/`)) walk(join(dir, entry.name), out);
    } else if (/\.(ts|tsx|js|json|prisma|sql)$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe("payment gateway surface", () => {
  it("exposes only the Cashfree webhook, with no legacy providerless route", () => {
    const routes = readSrc("routes/paymentRoutes.ts");
    expect(routes).toContain('router.post("/webhook/cashfree"');
    expect(routes).toContain('router.get("/webhook/cashfree"');
    // A bare `/webhook` is what a retired gateway's endpoint collapses into, and
    // it invites the provider to be chosen by the shape of the payload.
    expect(routes).not.toMatch(/router\.(post|get)\(\s*"\/webhook"/);
  });

  it("keeps webhook authenticity decided on the raw body, not the parsed payload", () => {
    // A route-level check here would be a lie: the signature is over exact
    // bytes, which only the raw-body capture can preserve.
    expect(readSrc("app.ts")).toContain("webhookRawBody");
    expect(readSrc("middleware/webhookRawBody.ts")).toBeTruthy();
  });

  it("has no Razorpay service and no Razorpay credential to satisfy", () => {
    expect(existsSync(join(SRC, "services/razorpayService.ts"))).toBe(false);
    const env = readSrc("config/env.ts");
    expect(env).not.toMatch(/RAZORPAY/);
  });

  it("defaults the recorded provider to Cashfree and allows no other value", () => {
    const schema = read(join(BACKEND, "prisma/schema.prisma"));
    expect(schema).toMatch(/provider\s+String\s+@default\("cashfree"\)/);
    // A union in a comment is documentation, not a guarantee. The guarantee is
    // that nothing can write a different value through the model.
    expect(schema).not.toMatch(/provider\s+String\?\s+\/\/\s*razorpay/i);
  });

  it("stores the gateway's own identifiers, with no legacy columns left to fill", () => {
    const schema = read(join(BACKEND, "prisma/schema.prisma"));
    expect(schema).not.toMatch(/razorpay/i);
    expect(schema).toContain("cashfreeOrderId");
    expect(schema).toContain("cashfreePaymentId");
    expect(schema).toContain("cashfreeRefundId");
  });

  it("drops the old columns in a forward migration rather than rewriting history", () => {
    // Rewriting an applied migration would leave every environment that already
    // ran it silently out of sync with the file that describes it.
    const dir = join(BACKEND, "prisma/migrations");
    const names = readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const drop = names.filter((n) => /razorpay/i.test(n));
    expect(drop.length).toBeGreaterThan(0);

    const sql = read(join(dir, drop[drop.length - 1], "migration.sql"));
    for (const [table, col] of [
      ["PaymentOrder", "razorpayOrderId"],
      ["PaymentOrder", "razorpayPaymentId"],
      ["Booking", "razorpayOrderId"],
      ["Booking", "razorpayPaymentId"],
      ["Booking", "razorpaySignature"],
      ["RefundLog", "razorpayRefundId"],
    ]) {
      expect(sql).toContain(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${col}"`);
    }
    // The identifier the new flow records has to exist for the migration to
    // leave anything usable behind.
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "cashfreeRefundId"');
  });

  it("claims the order before writing a settled state", () => {
    // A repeat verify has to be a no-op rather than a second credit, and that
    // is enforced by a compare-and-set on the order id rather than by a
    // read-then-write, which two concurrent webhooks can both pass.
    const booking = readSrc("controllers/bookingController.ts");
    expect(booking).toMatch(/updateMany\(\{[\s\S]*?cashfreeOrderId/);
    expect(booking).toMatch(/cashfreePaymentId:\s*verified\.gatewayPaymentId/);
  });
});

describe("no retired gateway survives anywhere it could be reached from", () => {
  it("has no live Razorpay identifier in backend, web or mobile source", () => {
    const self = __filename;
    const offenders: string[] = [];
    for (const pkg of ["backend", "web", "mobile"]) {
      for (const file of walk(join(REPO, "packages", pkg))) {
        // This file names the identifiers on purpose; it is the rule, not a
        // violation of it.
        if (file === self) continue;
        if (LIVE_REFERENCE.test(code(read(file)))) {
          offenders.push(file.slice(REPO.length + 1));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not ship a retired payment SDK", () => {
    for (const manifest of [
      join(REPO, "packages/backend/package.json"),
      join(REPO, "packages/mobile/package.json"),
      join(REPO, "package.json"),
    ]) {
      if (existsSync(manifest)) expect(read(manifest)).not.toMatch(/razorpay/i);
    }
  });

  it("does not leave the retired key in a client bundle or template env", () => {
    // The web bundle is public, so a leftover publishable key is a leaked
    // credential even though the secret side is already gone.
    for (const f of [
      join(REPO, ".env.example"),
      join(REPO, "packages/web/.env.example"),
      join(REPO, "packages/web/.env.production"),
      join(REPO, "packages/backend/.env.example"),
    ]) {
      if (existsSync(f)) expect(read(f)).not.toMatch(/RAZORPAY/i);
    }
  });

  it("tells the payer which gateway actually takes their money", () => {
    // Leaving the old name in the terms or on the receipt is not cosmetic: it
    // is the name on the statement the payer will check against.
    expect(read(join(REPO, "packages/web/src/pages/settings/TermsOfServicePage.tsx"))).toMatch(
      /Cashfree/
    );
    expect(read(join(REPO, "packages/backend/src/app.ts"))).toMatch(/Cashfree/);
  });
});

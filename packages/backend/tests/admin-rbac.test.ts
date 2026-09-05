/**
 * RENTBUDDY — Advanced Admin RBAC :: End-to-End Security Test
 * ============================================================
 * Covers spec sections 30 & 31:
 *  - 6 admin accounts (1 Super + 5 delegated) with scoped section/action perms
 *  - Backend-enforced permission checks (no reliance on hidden UI)
 *  - Unauthorized actions MUST fail with 403 (PERMISSION_DENIED)
 *  - Promotional credit ledger (small = instant, large = two-step approval)
 *  - Offer lifecycle with frozen snapshot
 *  - Audit log is written for sensitive actions
 *
 * Run:  node node_modules/tsx/dist/cli.mjs tests/admin-rbac.test.ts
 */
import axios, { AxiosInstance } from "axios";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";
import type { Server } from "http";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    failures.push(name + (detail ? ` — ${detail}` : ""));
    console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

// Admin login returns a session token directly (no OTP second factor).
async function login(api: AxiosInstance, email: string, password: string): Promise<string | null> {
  const res = await api.post("/auth/login", { email, password });
  if (res.status === 200 && res.data?.data?.accessToken) return res.data.data.accessToken;
  return null;
}

async function main() {
  const server: Server = createApp();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as any).port;
  const api: AxiosInstance = axios.create({
    baseURL: `http://localhost:${port}/api`,
    validateStatus: () => true,
  });
  console.log(`\nTest server listening on port ${port}\n`);

  const creds = [
    { name: "SUPER_ADMIN", email: process.env.ADMIN_EMAIL ?? "santhoshkrishna958@gmail.com", password: process.env.ADMIN_PASSWORD ?? "300703Ss" },
    { name: "SUPPORT_ADMIN", email: "support@rentbuddy.app", password: "Support@1234" },
    { name: "FINANCE_ADMIN", email: "finance@rentbuddy.app", password: "Finance@1234" },
    { name: "KYC_ADMIN", email: "kyc@rentbuddy.app", password: "Kyc@1234" },
    { name: "MARKETING_ADMIN", email: "marketing@rentbuddy.app", password: "Marketing@1234" },
    { name: "PARTNER_ADMIN", email: "partner@rentbuddy.app", password: "Partner@1234" },
  ];

  const tokens: Record<string, string> = {};
  for (const c of creds) {
    const t = await login(api, c.email, c.password);
    check(`login ${c.name}`, !!t);
    if (t) tokens[c.name] = t;
  }

  const auth = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  // ---------------------------------------------------------------
  console.log("\n== SECTION 30: PERMISSION MATRIX (unauthorized must be DENIED) ==");
  // Support Admin: Support only — NO Pricing / Wallet / Withdrawals / Admin Mgmt
  check("Support: reports allowed", (await api.get("/admin/reports", { headers: auth("SUPPORT_ADMIN") })).status === 200);
  check("Support: pricing DENIED", (await api.get("/admin/pricing", { headers: auth("SUPPORT_ADMIN") })).status === 403);
  check("Support: wallets DENIED", (await api.get("/admin/wallets", { headers: auth("SUPPORT_ADMIN") })).status === 403);
  check("Support: withdrawals DENIED", (await api.get("/admin/withdrawals", { headers: auth("SUPPORT_ADMIN") })).status === 403);
  check("Support: admin-management DENIED", (await api.get("/admin/admins", { headers: auth("SUPPORT_ADMIN") })).status === 403);
  check("Support: kyc DENIED", (await api.get("/admin/kyc-queue", { headers: auth("SUPPORT_ADMIN") })).status === 403);

  // Finance Admin: NO Admin Management / KYC documents
  check("Finance: payments allowed", (await api.get("/admin/payments", { headers: auth("FINANCE_ADMIN") })).status === 200);
  check("Finance: wallets allowed", (await api.get("/admin/wallets", { headers: auth("FINANCE_ADMIN") })).status === 200);
  check("Finance: withdrawals allowed", (await api.get("/admin/withdrawals", { headers: auth("FINANCE_ADMIN") })).status === 200);
  check("Finance: admin-management DENIED", (await api.get("/admin/admins", { headers: auth("FINANCE_ADMIN") })).status === 403);
  check("Finance: kyc DENIED", (await api.get("/admin/kyc-queue", { headers: auth("FINANCE_ADMIN") })).status === 403);
  check("Finance: pricing DENIED", (await api.get("/admin/pricing", { headers: auth("FINANCE_ADMIN") })).status === 403);

  // Marketing Admin: NO Wallet / Withdrawals / Pricing
  check("Marketing: offers allowed", (await api.get("/admin/offers", { headers: auth("MARKETING_ADMIN") })).status === 200);
  check("Marketing: coupons allowed", (await api.get("/admin/coupons", { headers: auth("MARKETING_ADMIN") })).status === 200);
  check("Marketing: wallets DENIED", (await api.get("/admin/wallets", { headers: auth("MARKETING_ADMIN") })).status === 403);
  check("Marketing: withdrawals DENIED", (await api.get("/admin/withdrawals", { headers: auth("MARKETING_ADMIN") })).status === 403);
  check("Marketing: pricing DENIED", (await api.get("/admin/pricing", { headers: auth("MARKETING_ADMIN") })).status === 403);

  // KYC Admin: NO Payment secrets
  check("KYC: kyc-queue allowed", (await api.get("/admin/kyc-queue", { headers: auth("KYC_ADMIN") })).status === 200);
  check("KYC: payments DENIED", (await api.get("/admin/payments", { headers: auth("KYC_ADMIN") })).status === 403);
  check("KYC: wallets DENIED", (await api.get("/admin/wallets", { headers: auth("KYC_ADMIN") })).status === 403);

  // Super Admin: everything allowed
  check("Super: admin-management allowed", (await api.get("/admin/admins", { headers: auth("SUPER_ADMIN") })).status === 200);
  check("Super: pricing allowed", (await api.get("/admin/pricing", { headers: auth("SUPER_ADMIN") })).status === 200);
  check("Super: wallets allowed", (await api.get("/admin/wallets", { headers: auth("SUPER_ADMIN") })).status === 200);
  check("Super: analytics allowed", (await api.get("/admin/analytics", { headers: auth("SUPER_ADMIN") })).status === 200);
  check("Super: cities allowed", (await api.get("/admin/cities", { headers: auth("SUPER_ADMIN") })).status === 200);

  // A plain USER must not access admin at all
  const userReg = await api.post("/auth/register", {
    email: `rbac-${Date.now()}@rentbuddy.com`, password: "User@1234", fullName: "RBAC User",
    phone: "+9197" + String(Date.now()).slice(-8), dateOfBirth: "2000-01-01", gender: "OTHER",
  });
  const userToken = userReg.data?.data?.accessToken;
  if (userToken) {
    check("User: admin endpoint DENIED", (await api.get("/admin/users", { headers: { Authorization: `Bearer ${userToken}` } })).status === 403);
  } else {
    check("User: registered", false, "no token");
  }

  // ---------------------------------------------------------------
  console.log("\n== SECTION 9-13: PROMOTIONAL CREDIT LEDGER ==");
  // Create a target user to receive credit.
  const tUser = await api.post("/auth/register", {
    email: `credit-${Date.now()}@rentbuddy.com`, password: "User@1234", fullName: "Credit Target",
    phone: "+9196" + String(Date.now()).slice(-8), dateOfBirth: "2000-01-01", gender: "OTHER",
  });
  const targetUserId = tUser.data?.data?.user?.id;
  check("credit target created", !!targetUserId);

  if (targetUserId) {
    // Small credit by Finance Admin -> instant.
    const small = await api.post("/admin/credit/grant", { userId: targetUserId, amount: 100, reason: "welcome bonus", creditType: "PROMOTIONAL_CREDIT" }, { headers: auth("FINANCE_ADMIN") });
    check("Finance grants small credit (201)", small.status === 201, `status ${small.status}`);
    const wal = await api.get(`/admin/wallets?search=`, { headers: auth("SUPER_ADMIN") });
    // Verify via ledger.
    const ledger = await api.get(`/admin/credit/ledger?userId=${targetUserId}`, { headers: auth("FINANCE_ADMIN") });
    const hasCredit = (ledger.data?.data?.items ?? []).some((l: any) => l.type === "PROMOTIONAL_CREDIT" && Number(l.amount) === 100);
    check("credit ledger recorded", hasCredit);

    // Large credit by Finance Admin -> two-step approval (202 pending).
    const large = await api.post("/admin/credit/grant", { userId: targetUserId, amount: 10000, reason: "goodwill", creditType: "PROMOTIONAL_CREDIT" }, { headers: auth("FINANCE_ADMIN") });
    check("Finance large credit routed to approval (202)", large.status === 202, `status ${large.status}`);
    const reqId = large.data?.data?.approvalRequestId;
    check("approval request id returned", !!reqId);

    // Super Admin approves.
    if (reqId) {
      const review = await api.post(`/admin/approvals/${reqId}/review`, { decision: "APPROVE" }, { headers: auth("SUPER_ADMIN") });
      check("Super approves large credit (200)", review.status === 200, `status ${review.status}`);
      const ledger2 = await api.get(`/admin/credit/ledger?userId=${targetUserId}`, { headers: auth("FINANCE_ADMIN") });
      const applied = (ledger2.data?.data?.items ?? []).some((l: any) => Number(l.amount) === 10000);
      check("approved large credit applied to ledger", applied);
    }
    // Finance Admin cannot self-approve (not Super) -> 403.
    if (reqId) {
      const selfReview = await api.post(`/admin/approvals/${reqId}/review`, { decision: "APPROVE" }, { headers: auth("FINANCE_ADMIN") });
      check("Finance CANNOT approve (403)", selfReview.status === 403, `status ${selfReview.status}`);
    }
  }

  // ---------------------------------------------------------------
  console.log("\n== SECTIONS 7-8: OFFER LIFECYCLE ==");
  const offer = await api.post("/admin/offers", { code: `TEST${Date.now()}`, title: "First booking 20%", type: "FIRST_BOOKING", discountType: "PERCENTAGE", discountValue: 20, minBooking: 50 }, { headers: auth("MARKETING_ADMIN") });
  check("Marketing creates offer (201)", offer.status === 201, `status ${offer.status}`);
  const offerId = offer.data?.data?.id;
  if (offerId) {
    const preview = await api.post(`/admin/offers/${offerId}/status`, { status: "PREVIEW" }, { headers: auth("MARKETING_ADMIN") });
    check("Marketing previews offer (200)", preview.status === 200, `status ${preview.status}`);
    const activate = await api.post(`/admin/offers/${offerId}/status`, { status: "ACTIVE" }, { headers: auth("MARKETING_ADMIN") });
    check("Marketing activates offer (200)", activate.status === 200, `status ${activate.status}`);
    check("offer snapshot frozen on activate", !!activate.data?.data?.snapshot, "no snapshot");
    const badTransition = await api.post(`/admin/offers/${offerId}/status`, { status: "PREVIEW" }, { headers: auth("MARKETING_ADMIN") });
    check("invalid transition rejected (400)", badTransition.status === 400, `status ${badTransition.status}`);
  }
  // Support Admin cannot create offers (no OFFERS.CREATE).
  const offerDenied = await api.post("/admin/offers", { code: "X", title: "x", type: "FIXED_AMOUNT_DISCOUNT" }, { headers: auth("SUPPORT_ADMIN") });
  check("Support CANNOT create offer (403)", offerDenied.status === 403, `status ${offerDenied.status}`);

  // ---------------------------------------------------------------
  console.log("\n== SECTION 5: AUDIT LOG ==");
  const audit = await api.get("/admin/audit-logs", { headers: auth("SUPER_ADMIN") });
  check("audit logs retrievable (200)", audit.status === 200);
  const items = audit.data?.data?.items ?? [];
  check("audit log captured admin actions", items.length > 0, `count ${items.length}`);
  const sawCredit = items.some((a: any) => /CREDIT|OFFER|APPROVAL/.test(a.action));
  check("audit log includes credit/offer/approval actions", sawCredit);

  // ---------------------------------------------------------------
  console.log("\n== SECTION 27: CITY MANAGEMENT (Super only) ==");
  const city = await api.post("/admin/cities", { key: `CITY${Date.now()}`, name: "Test City", state: "TN" }, { headers: auth("SUPER_ADMIN") });
  check("Super creates city (201)", city.status === 201, `status ${city.status}`);
  const cityDenied = await api.post("/admin/cities", { key: "X", name: "x" }, { headers: auth("FINANCE_ADMIN") });
  check("Finance CANNOT create city (403)", cityDenied.status === 403, `status ${cityDenied.status}`);

  // ---------------------------------------------------------------
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await prisma.$disconnect();

  console.log(`\n==== RESULT: ${pass} passed, ${fail} failed ====`);
  if (fail > 0) {
    console.log("FAILURES:\n - " + failures.join("\n - "));
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

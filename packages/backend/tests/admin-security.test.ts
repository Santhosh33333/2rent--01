import axios from "axios";
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";
import type { Server } from "http";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = "") {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  const server: Server = createApp();
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const api = axios.create({ baseURL: `http://localhost:${port}/api`, validateStatus: () => true });

  const login = async (email: string, password: string, extra: any = {}) => {
    return api.post("/auth/login", { email, password, ...extra });
  };

  // Full login (no OTP second factor). Returns the login response.
  const loginFull = async (email: string, password: string) => {
    return login(email, password);
  };

  const superEmail = process.env.ADMIN_EMAIL || "santhoshkrishna958@gmail.com";
  const superPassword = process.env.ADMIN_PASSWORD || "300703S#s";
  const superLogin = await loginFull(superEmail, superPassword);
  const superToken = superLogin.data?.data?.accessToken;
  check("Super login (200)", superLogin.status === 200 && !!superToken, `status ${superLogin.status}`);
  if (!superToken) {
    console.log("\nRESULT: 0 passed, 1 failed");
    await server.close(() => prisma.$disconnect().then(() => process.exit(1)));
    return;
  }

  const supportEmail = "support@rentbuddy.app";
  const supportPassword = "Support@1234";
  const support = await prisma.adminUser.findFirst({ where: { user: { email: supportEmail } }, select: { userId: true } });
  const supportUserId = support!.userId;
  const supportLogin = await loginFull(supportEmail, supportPassword);
  const supportToken = supportLogin.data?.data?.accessToken;
  check("Support login baseline (200)", supportLogin.status === 200 && !!supportToken, `status ${supportLogin.status}`);

  // ---- IP ALLOWLIST ----
  console.log("\n== IP ALLOWLIST ==");
  const setAllow = await api.patch(`/admin/admins/${supportUserId}/security`, { ipAllowList: ["9.9.9.9"] }, { headers: auth(superToken) });
  check("Super set IP allowlist (200)", setAllow.status === 200, `status ${setAllow.status}`);
  const blocked = await login(supportEmail, supportPassword);
  check("Login from non-allowed IP blocked (403)", blocked.status === 403 && blocked.data?.error === "ADMIN_IP_DENIED", `status ${blocked.status}`);
  const clearAllow = await api.patch(`/admin/admins/${supportUserId}/security`, { ipAllowList: [] }, { headers: auth(superToken) });
  check("Super clears IP allowlist (200)", clearAllow.status === 200, `status ${clearAllow.status}`);
  const unblocked = await loginFull(supportEmail, supportPassword);
  check("Login allowed after clearing allowlist (200)", unblocked.status === 200, `status ${unblocked.status}`);

  // ---- LOCKOUT AFTER FAILED ATTEMPTS ----
  console.log("\n== ACCOUNT LOCKOUT ==");
  await api.post(`/admin/admins/${supportUserId}/mfa-reset`, {}, { headers: auth(superToken) }); // resets attempts+lock
  for (let i = 0; i < 5; i++) {
    const f = await login(supportEmail, "wrong-password");
    check(`Failed attempt ${i + 1} (401)`, f.status === 401, `status ${f.status}`);
  }
  const locked = await login(supportEmail, supportPassword);
  check("Correct password while locked (423)", locked.status === 423 && locked.data?.error === "ACCOUNT_LOCKED", `status ${locked.status}`);
  await api.post(`/admin/admins/${supportUserId}/mfa-reset`, {}, { headers: auth(superToken) });
  const recovered = await loginFull(supportEmail, supportPassword);
  check("Login succeeds after Super resets lock (200)", recovered.status === 200, `status ${recovered.status}`);

  // ---- CONCURRENT SESSION LIMIT ----
  console.log("\n== SESSION LIMIT ==");
  const setLimit = await api.patch(`/admin/admins/${supportUserId}/security`, { sessionLimit: 1 }, { headers: auth(superToken) });
  check("Super sets session limit=1 (200)", setLimit.status === 200, `status ${setLimit.status}`);
  await loginFull(supportEmail, supportPassword);
  await loginFull(supportEmail, supportPassword);
  await loginFull(supportEmail, supportPassword);
  const sessions = await api.get("/admin/security/sessions", { headers: auth(supportToken) });
  const activeCount = sessions.data?.data?.sessions?.length ?? 0;
  check("Active sessions capped at limit (<=1)", activeCount <= 1, `active=${activeCount}`);
  await api.patch(`/admin/admins/${supportUserId}/security`, { sessionLimit: 1 }, { headers: auth(superToken) });

  // ---- SUPER SECURITY MANAGEMENT ----
  console.log("\n== SUPER SECURITY MANAGEMENT ==");
  const getSec = await api.get(`/admin/admins/${supportUserId}/security`, { headers: auth(superToken) });
  check("Super reads admin security (200)", getSec.status === 200 && getSec.data?.data?.userId === supportUserId, `status ${getSec.status}`);
  const updSec = await api.patch(`/admin/admins/${supportUserId}/security`, { loginAlertsEnabled: false, requirePasswordRotation: true }, { headers: auth(superToken) });
  check("Super updates admin security (200)", updSec.status === 200 && updSec.data?.data?.loginAlertsEnabled === false, `status ${updSec.status}`);
  const mfaReset = await api.post(`/admin/admins/${supportUserId}/mfa-reset`, {}, { headers: auth(superToken) });
  check("Super can reset admin MFA (200)", mfaReset.status === 200, `status ${mfaReset.status}`);

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n==== RESULT: ${passed} passed, ${failed} failed ====`);
  if (failed > 0) console.log("FAILURES:", results.filter((r) => !r.ok).map((r) => r.name).join("; "));

  await server.close(() => prisma.$disconnect().then(() => process.exit(failed > 0 ? 1 : 0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

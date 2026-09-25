import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as fs from "fs";

const b64 = fs.readFileSync("C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64", "utf8").trim();
process.env.DATABASE_URL = Buffer.from(b64, "base64").toString("utf8");
const prisma = new PrismaClient();

const API = "https://rentbuddy-api-s7rz.onrender.com/api";
const EMAIL = `e2e-partner-${Date.now()}@test.local`;
const PASSWORD = "E2ePartner#9xQ!22";

async function call(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: "follow",
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = JSON.parse(text); } catch { data = text.slice(0, 300); }
  return { status: res.status, data };
}

async function main() {
  const email = EMAIL;
  // 1) Seed test user + approved partner + wallet directly in prod DB.
  const hash = await bcrypt.hash(PASSWORD, 10);
  const user = await prisma.user.create({
    data: {
      email,
      phone: `+91999999${String(Math.floor(1000 + Math.random() * 9000))}`,
      passwordHash: hash,
      fullName: "E2E Partner Tester",
      dateOfBirth: new Date("1992-05-05"),
      gender: "OTHER",
      role: "USER",
      activeRole: "USER",
      status: "ACTIVE",
      emailVerified: true,
      mobileVerified: true,
    },
  });
  await prisma.wallet.create({ data: { userId: user.id } });
  await prisma.partner.create({
    data: { userId: user.id, status: "APPROVED", providesWalking: true, providesCarry: true },
  });
  console.log(`Seeded test user ${email} id=${user.id}`);

  const check = (name: string, got: number, expected: number) => {
    const ok = got === expected;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}: expected ${expected}, got ${got}`);
    return ok;
  };

  // 2) login
  const login = await call("POST", "/auth/login", { email, password: PASSWORD });
  check("login 200", login.status, 200);
  const token = (login.data as any)?.data?.accessToken as string;
  const userInfo = (login.data as any)?.data?.user;
  console.log("  login user: role=%s activeRole=%s accountType=%s", userInfo?.role, userInfo?.activeRole, userInfo?.accountType);
  if (!token) throw new Error("no token");

  // 3) my-roles
  const roles = await call("GET", "/roles/my-roles", undefined, token);
  const rd = (roles.data as any)?.data;
  console.log("  approvedRoles=%s activeRole=%s", JSON.stringify(rd?.approvedRoles), rd?.activeRole);
  check("my-roles 200", roles.status, 200);
  const partnerApproved = Array.isArray(rd?.approvedRoles) && rd.approvedRoles.includes("PARTNER");

  // 4) switch to PARTNER
  const sw = await call("POST", "/roles/switch", { role: "PARTNER" }, token);
  console.log("  switch resp: %s %s", sw.status, JSON.stringify((sw.data as any)?.message || (sw.data as any)?.error));
  check("switch 200", sw.status, 200);

  // 5) partner status + bookings with refreshed token
  const status = await call("GET", "/partner/status", undefined, token);
  const sd = (status.data as any)?.data;
  console.log("  partner status: %s %s", status.status, JSON.stringify(sd)?.slice(0, 160));
  check("partner/status 200", status.status, 200);

  const bookings = await call("GET", "/partner/bookings", undefined, token);
  check("partner/bookings 200", bookings.status, 200);

  // 6) clean up
  await prisma.partner.deleteMany({ where: { userId: user.id } });
  await prisma.wallet.deleteMany({ where: { userId: user.id } });
  await prisma.user.deleteMany({ where: { id: user.id } });
  console.log(`\nCleaned up test user. partnerApprovedRoles=${partnerApproved}`);
  const allOk = [login.status === 200, roles.status === 200, partnerApproved, sw.status === 200, status.status === 200, bookings.status === 200].every(Boolean);
  console.log(allOk ? "\nE2E PARTNER NAVIGATION: FULLY WORKING" : "\nE2E PARTNER NAVIGATION: SOMETHING FAILED");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
import { prisma } from "../src/config/database";

const BASE = "http://localhost:5000/api";

async function call(method: string, path: string, body: any, token?: string) {
  const headers: any = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, json };
}

function tokenOf(json: any): string | null {
  const d = json?.data;
  if (typeof d?.accessToken === "string") return d.accessToken;
  if (typeof d?.token === "string") return d.token;
  if (d?.data && typeof d.data.accessToken === "string") return d.data.accessToken;
  if (d?.data && typeof d.data.token === "string") return d.data.token;
  if (typeof json?.accessToken === "string") return json.accessToken;
  if (typeof json?.token === "string") return json.token;
  return null;
}

async function main() {
  const suffix = Math.random().toString(36).slice(2, 8);
  const email = `upitest_${suffix}@example.com`;
  const phone = `+91${98}${Math.floor(10000000 + Math.random() * 89999999)}`;

  // 1) Admin login (uses env vars — set ADMIN_EMAIL/ADMIN_PASSWORD in .env)
  const adminEmail = process.env.ADMIN_EMAIL || "admin@rentbuddy.app";
  const adminPassword = process.env.ADMIN_PASSWORD || "ChangeMe!";
  const adminLogin = await call("POST", "/auth/login", { email: adminEmail, password: adminPassword });
  const adminToken = tokenOf(adminLogin.json);
  console.log("[1] admin login:", adminLogin.status, adminToken ? "OK" : JSON.stringify(adminLogin.json));

  // 2) Set UPI config
  const setUpi = await call("PUT", "/admin/settings/upi", { upiId: "test@upi", accountName: "Test Account", qrUrl: "" }, adminToken!);
  console.log("[2] set UPI config:", setUpi.status, JSON.stringify(setUpi.json?.data ?? setUpi.json));

  // 3) Get UPI config
  const getUpi = await call("GET", "/admin/settings/upi", null, adminToken!);
  console.log("[3] get UPI config:", getUpi.status, JSON.stringify(getUpi.json?.data));

  // 4) Register a user
  const reg = await call("POST", "/auth/register", {
    email, phone, password: "TestPass123!", fullName: "UPI Tester",
    dateOfBirth: "1995-05-05", gender: "OTHER",
  });
  console.log("[4] register:", reg.status, JSON.stringify(reg.json).slice(0, 400));

  // 5) Mark KYC verified in DB (admin approval simulation)
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error("user not created");
  await prisma.verification.upsert({
    where: { userId: user.id },
    create: { userId: user.id, status: "VERIFIED" },
    update: { status: "VERIFIED" },
  });

  // 6) Login as user
  const login = await call("POST", "/auth/login", { email, password: "TestPass123!" });
  const userToken = tokenOf(login.json);
  console.log("[6] user login:", login.status, userToken ? "OK" : JSON.stringify(login.json));

  // 7) Create booking with UPI_MANUAL
  const future = new Date(Date.now() + 3600_000).toISOString();
  const create = await call("POST", "/bookings", {
    serviceType: "WALKING",
    startLocation: "MG Road", endLocation: "Cubbon Park",
    scheduledAt: future, durationMinutes: 30,
    notes: JSON.stringify({ paymentMethod: "UPI_MANUAL" }),
  }, userToken!);
  const booking: any = create.json?.data;
  console.log("[7] create booking:", create.status, "status=", booking?.status, "paymentStatus=", booking?.paymentStatus, "id=", booking?.id?.slice(0, 8));

  const bid = booking!.id;

  // 8) Get UPI details
  const det = await call("GET", `/bookings/${bid}/upi-details`, null, userToken!);
  console.log("[8] upi-details:", det.status, "upiId=", det.json?.data?.upiId, "amount=", det.json?.data?.amount);

  // 9) Submit reference
  const ref = "UTR" + suffix.toUpperCase() + "000";
  const sub = await call("POST", `/bookings/${bid}/upi-reference`, { referenceNumber: ref }, userToken!);
  console.log("[9] submit reference:", sub.status, JSON.stringify(sub.json?.data ?? sub.json));

  // 10) Duplicate reference rejected
  const dup = await call("POST", `/bookings/${bid}/upi-reference`, { referenceNumber: ref }, userToken!);
  console.log("[10] duplicate reference:", dup.status, dup.json?.code);

  // 11) Admin list
  const list = await call("GET", "/admin/payments/upi", null, adminToken!);
  console.log("[11] admin list:", list.status, "count=", list.json?.data?.total, "ref=", list.json?.data?.items?.[0]?.referenceNumber);

  // 12) Admin verify (fund wallet first to simulate a top-up / escrow hold)
  await prisma.wallet.upsert({ where: { userId: user.id }, create: { userId: user.id, balance: 500 }, update: { balance: 500 } });
  const verify = await call("POST", `/admin/payments/upi/${list.json.data.items[0].id}/verify`, { action: "VERIFY" }, adminToken!);
  console.log("[12] admin verify:", verify.status, JSON.stringify(verify.json?.data ?? verify.json));

  // 13) Booking confirmed
  const finalBooking = await call("GET", `/bookings/${bid}`, null, userToken!);
  const fb: any = finalBooking.json?.data;
  console.log("[13] booking after verify: status=", fb?.status, "paymentStatus=", fb?.paymentStatus);

  await prisma.$disconnect();
}

main().catch((e) => { console.error("TEST FAILED:", e); process.exit(1); });

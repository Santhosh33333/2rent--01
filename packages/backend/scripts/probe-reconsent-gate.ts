/**
 * Temporary probe: does the re-consent gate actually block at runtime, and only
 * once the grace period has genuinely lapsed?
 *
 * The structural wiring test proves the middleware is in the chain. This proves
 * the behaviour, including the two ways it must NOT block: before the user was
 * ever notified, and while the grace window is still open.
 */
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const PORT = 4601;
const BASE = `http://127.0.0.1:${PORT}/api`;
const stamp = Date.now();
const created: string[] = [];

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    pass += 1;
    console.log(`  ok   ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${label} ${detail}`);
  }
}

async function main() {
  const server = createApp().listen(PORT);
  await new Promise((r) => setTimeout(r, 600));

  try {
    // A user who signed up, then has their signup acceptance removed so the
    // current SIGNUP documents are owed. This is the legacy-account shape.
    const email = `probe.reconsent.${stamp}@example.com`;
    const reg = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        phone: `8${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
        password: "ProbePass123!",
        fullName: "Probe Reconsent",
        dateOfBirth: "1992-02-02",
        gender: "OTHER",
        legalConsent: { accepted: true, signatureValue: "Probe Reconsent" },
      }),
    });
    const rj: any = await reg.json();
    const token = rj?.data?.accessToken;
    const userId = rj?.data?.user?.id;
    check("registered", !!token && !!userId);
    if (userId) created.push(userId);

    const auth = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // Another real user to talk to, so the chat send passes non-ownership checks.
    const other = await fetch(`${BASE}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `probe.target.${stamp}@example.com`,
        phone: `7${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
        password: "ProbePass123!",
        fullName: "Probe Target",
        dateOfBirth: "1993-03-03",
        gender: "OTHER",
        legalConsent: { accepted: true, signatureValue: "Probe Target" },
      }),
    });
    const oj: any = await other.json();
    const targetId = oj?.data?.user?.id;
    if (targetId) created.push(targetId);
    check("target user created", !!targetId);

    const sendChat = () =>
      fetch(`${BASE}/messages`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ receiverId: targetId, content: "hello there friend" }),
      });

    // Chat is KYC-gated ahead of everything else, so a brand-new account is
    // refused with a KYC error long before any consent logic runs. Both users
    // are approved here so the probe measures the consent gate rather than the
    // onboarding gate sitting in front of it.
    for (const id of [userId, targetId].filter(Boolean) as string[]) {
      await prisma.verification.upsert({
        where: { userId: id },
        create: { userId: id, status: "VERIFIED" },
        update: { status: "VERIFIED" },
      });
    }
    const kycCheck = await sendChat();
    check(
      "chat reachable once KYC is out of the way",
      kycCheck.status === 200 || kycCheck.status === 201,
      `status=${kycCheck.status}`
    );

    // The re-consent payload is nested under `reConsent` by the controller.
    const rc = (body: any) => body?.data?.reConsent ?? {};

    console.log("\n[1] fully consented user is not blocked");
    let r = await sendChat();
    check("chat send allowed while consented", r.status === 200 || r.status === 201, `status=${r.status}`);

    console.log("\n[2] owed documents, but never notified yet");
    await prisma.legalAcceptance.deleteMany({ where: { userId, consentType: "SIGNUP" } });
    await prisma.legalReConsent.deleteMany({ where: { userId } });

    r = await sendChat();
    const b1: any = await r.json();
    // No notice row yet: the user has not been shown a deadline, so blocking
    // them here would be indefensible.
    check("chat NOT blocked before any notice exists", r.status !== 403, `status=${r.status} ${b1?.error?.code}`);

    console.log("\n[3] notice exists, grace window still open");
    const state = await fetch(`${BASE}/legal/re-consent`, { headers: auth });
    const sj: any = await state.json();
    check("re-consent state reports required", rc(sj)?.required === true, JSON.stringify(rc(sj)));
    check("re-consent state reports not blocking", rc(sj)?.blocking === false);
    check("grace window has days remaining", (rc(sj)?.daysRemaining ?? 0) > 0, `days=${rc(sj)?.daysRemaining}`);

    r = await sendChat();
    check("chat NOT blocked inside the grace window", r.status !== 403, `status=${r.status}`);

    console.log("\n[4] grace window genuinely lapsed");
    // Backdate the notice rather than editing config, so the notice the user was
    // actually shown is the one being tested.
    await prisma.legalReConsent.update({
      where: { userId },
      data: { notifiedAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000) },
    });

    const state2 = await fetch(`${BASE}/legal/re-consent`, { headers: auth });
    const s2: any = await state2.json();
    check("re-consent state now reports blocking", rc(s2)?.blocking === true, JSON.stringify(rc(s2)));

    const chat = await sendChat();
    const cj: any = await chat.json();
    check("chat send BLOCKED after lapse", chat.status === 403, `status=${chat.status}`);
    check("block is LEGAL_RECONSENT_REQUIRED", cj?.error?.code === "LEGAL_RECONSENT_REQUIRED", cj?.error?.code);
    check("block response includes graceEndsAt", !!cj?.error?.graceEndsAt);
    check("block response includes missing docs", Array.isArray(cj?.error?.missing) && cj.error.missing.length > 0);

    const call = await fetch(`${BASE}/calls`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ receiverId: targetId, type: "AUDIO" }),
    });
    const cl: any = await call.json();
    check("call create BLOCKED after lapse", call.status === 403, `status=${call.status}`);
    check("call block is LEGAL_RECONSENT_REQUIRED", cl?.error?.code === "LEGAL_RECONSENT_REQUIRED", cl?.error?.code);

    const booking = await fetch(`${BASE}/bookings`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        serviceType: "companion",
        startLocation: "Koramangala",
        endLocation: "Indiranagar",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      }),
    });
    const bk: any = await booking.json();
    // Either the re-consent block or an earlier gate (KYC/legal) is a refusal;
    // what must not happen is a booking being created.
    check("booking create refused after lapse", booking.status >= 400, `status=${booking.status} ${bk?.error?.code}`);

    console.log("\n[5] accepting the current terms unblocks again");
    const kinds = ["USER_AGREEMENT", "PRIVACY_POLICY", "COMMUNITY_GUIDELINES"];
    for (const kind of kinds) {
      const acc = await fetch(`${BASE}/legal/accept`, {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          kind,
          signatureType: "TYPED_NAME",
          signatureValue: "Probe Reconsent",
          consentType: "RE_CONSENT",
        }),
      });
      check(`accepted ${kind}`, acc.status === 200 || acc.status === 201, `status=${acc.status}`);
    }

    const state3 = await fetch(`${BASE}/legal/re-consent`, { headers: auth });
    const s3: any = await state3.json();
    check("re-consent now satisfied", rc(s3)?.satisfied === true, JSON.stringify(rc(s3)));

    r = await sendChat();
    check("chat send allowed again after accepting", r.status === 200 || r.status === 201, `status=${r.status}`);

    console.log("\n[6] database truth");
    const notice = await prisma.legalReConsent.findUnique({ where: { userId } });
    check("notice marked satisfiedAt", !!notice?.satisfiedAt);
    const acceptances = await prisma.legalAcceptance.count({ where: { userId, consentType: "RE_CONSENT" } });
    check("3 re-consent acceptances stored", acceptances === 3, `n=${acceptances}`);
  } finally {
    console.log("\n[cleanup]");
    const ids = created.filter(Boolean);
    if (ids.length) {
      await prisma.legalAcceptance.deleteMany({ where: { userId: { in: ids } } });
      await prisma.legalReConsent.deleteMany({ where: { userId: { in: ids } } });
      await prisma.message.deleteMany({ where: { senderId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    const leftover = await prisma.user.count({
      where: { email: { contains: `probe.reconsent.${stamp}` } },
    });
    console.log(`  probe users remaining: ${leftover}`);
    await prisma.$disconnect();
    server.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error("probe crashed:", e);
  await prisma.$disconnect();
  process.exit(1);
});

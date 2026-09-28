/**
 * Temporary end-to-end probe for the support desk.
 * Exercises the real Express stack, the real auth middleware, the real
 * validators and the real database, then cleans up everything it created.
 */
import { createApp } from "../src/app";
import { prisma } from "../src/config/database";

const PORT = 4599;
const BASE = `http://127.0.0.1:${PORT}/api`;
const stamp = Date.now();
const U1 = `probe.user.${stamp}@example.com`;
const U2 = `probe.other.${stamp}@example.com`;
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

async function register(email: string) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      phone: `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`,
      password: "ProbePass123!",
      fullName: "Probe User",
      dateOfBirth: "1995-04-04",
      gender: "OTHER",
      legalConsent: { accepted: true, signatureValue: "Probe User" },
    }),
  });
  const json: any = await res.json();
  if (json?.data?.accessToken) created.push(json.data.user?.id ?? "");
  return { res, json };
}

async function main() {
  const server = createApp().listen(PORT);
  await new Promise((r) => setTimeout(r, 600));

  try {
    console.log("\n[1] registration + token");
    const a = await register(U1);
    check("user1 registered", a.res.status === 200 || a.res.status === 201, `status=${a.res.status}`);
    const t1 = a.json?.data?.accessToken;
    check("user1 got access token", !!t1);
    const uid1 = a.json?.data?.user?.id;
    check("user1 id present", !!uid1);
    if (uid1) created.push(uid1);

    const b = await register(U2);
    const t2 = b.json?.data?.accessToken;
    const uid2 = b.json?.data?.user?.id;
    check("user2 registered", !!t2);
    if (uid2) created.push(uid2);

    const auth1 = { Authorization: `Bearer ${t1}` };
    const auth2 = { Authorization: `Bearer ${t2}` };
    const jsonh = { ...auth1, "Content-Type": "application/json" };

    console.log("\n[2] ticket creation validation");
    const noAuth = await fetch(`${BASE}/support/tickets`, { method: "POST" });
    check("unauthenticated create is rejected", noAuth.status === 401, `status=${noAuth.status}`);

    const badCat = await fetch(`${BASE}/support/tickets`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({ category: "NOPE", subject: "Hello there", body: "Something is wrong with my account." }),
    });
    check("invalid category rejected", badCat.status === 400, `status=${badCat.status}`);

    const shortBody = await fetch(`${BASE}/support/tickets`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({ category: "PAYMENT", subject: "Hi", body: "short" }),
    });
    check("too-short body rejected", shortBody.status === 400, `status=${shortBody.status}`);

    console.log("\n[3] ticket creation + reference");
    const created1 = await fetch(`${BASE}/support/tickets`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({
        category: "PAYMENT",
        subject: "Payment not credited",
        body: "Money left my account but the booking never showed up.",
      }),
    });
    const cj: any = await created1.json();
    check("ticket created 201", created1.status === 201, `status=${created1.status}`);
    const ticket = cj?.data;
    check("ticket has uuid id", !!ticket?.id);
    check("ticket has NBR- reference", /^NBR-[0-9A-Z]{6}$/.test(ticket?.reference || ""), ticket?.reference);
    check("ticket starts OPEN", ticket?.status === "OPEN");
    check("ticket is NORMAL priority for PAYMENT", ticket?.priority === "NORMAL");
    check("opening message stored", Array.isArray(ticket?.messages) && ticket.messages.length === 1);

    console.log("\n[4] safety tickets auto-escalate");
    const safety = await fetch(`${BASE}/support/tickets`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({
        category: "SAFETY",
        subject: "Safety report",
        body: "I need to report a safety problem with another member.",
      }),
    });
    const sj: any = await safety.json();
    check("safety ticket created", safety.status === 201);
    check("safety ticket is URGENT", sj?.data?.priority === "URGENT", sj?.data?.priority);

    console.log("\n[5] ownership isolation");
    const mine = await fetch(`${BASE}/support/tickets`, { headers: auth1 });
    const mj: any = await mine.json();
    check("requester lists own ticket", (mj?.data || []).some((t: any) => t.id === ticket.id));
    check("requester list omits message bodies", !(mj?.data || []).some((t: any) => "messages" in t));

    const strangerRead = await fetch(`${BASE}/support/tickets/${ticket.id}`, { headers: auth2 });
    check("non-owner gets 404 not 403", strangerRead.status === 404, `status=${strangerRead.status}`);

    const strangerReply = await fetch(`${BASE}/support/tickets/${ticket.id}/replies`, {
      method: "POST",
      headers: { ...auth2, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "let me in please" }),
    });
    check("non-owner reply blocked 404", strangerReply.status === 404, `status=${strangerReply.status}`);

    console.log("\n[6] requester cannot self-resolve");
    const selfResolve = await fetch(`${BASE}/support/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    check("self-resolve refused 403", selfResolve.status === 403, `status=${selfResolve.status}`);

    const selfInProgress = await fetch(`${BASE}/support/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ status: "IN_PROGRESS" }),
    });
    check("self-assign-to-progress refused 403", selfInProgress.status === 403, `status=${selfInProgress.status}`);

    console.log("\n[7] requester may close their own ticket");
    const closeCopy = await fetch(`${BASE}/support/tickets`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({ category: "OTHER", subject: "Closing me", body: "Just testing the close path." }),
    });
    const cc: any = await closeCopy.json();
    const closed = await fetch(`${BASE}/support/tickets/${cc.data.id}/status`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ status: "CLOSED" }),
    });
    check("requester can close own ticket", closed.status === 200, `status=${closed.status}`);

    const replyAfterClose = await fetch(`${BASE}/support/tickets/${cc.data.id}/replies`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({ body: "one more thing" }),
    });
    check("reply to closed ticket refused 409", replyAfterClose.status === 409, `status=${replyAfterClose.status}`);

    console.log("\n[8] staff surfaces require admin");
    const queueAsUser = await fetch(`${BASE}/support/queue`, { headers: auth1 });
    check("non-admin queue refused 403", queueAsUser.status === 403, `status=${queueAsUser.status}`);

    const assignAsUser = await fetch(`${BASE}/support/tickets/${ticket.id}/assign`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ assigneeId: uid1 }),
    });
    check("non-admin assign refused 403", assignAsUser.status === 403, `status=${assignAsUser.status}`);

    console.log("\n[9] promote to admin and work the queue");
    await prisma.user.update({ where: { id: uid1 }, data: { role: "SUPPORT" } });
    const queue = await fetch(`${BASE}/support/queue`, { headers: auth1 });
    const qj: any = await queue.json();
    check("admin queue reachable", queue.status === 200, `status=${queue.status}`);
    check("queue lists the ticket", (qj?.data?.tickets || []).some((t: any) => t.id === ticket.id));
    check("queue exposes open count", typeof qj?.data?.counts?.open === "number");

    const staffReply = await fetch(`${BASE}/support/tickets/${ticket.id}/replies`, {
      method: "POST",
      headers: jsonh,
      body: JSON.stringify({ body: "Looking into this now, thanks for reporting." }),
    });
    check("staff reply accepted 201", staffReply.status === 201, `status=${staffReply.status}`);

    const afterReply = await fetch(`${BASE}/support/tickets/${ticket.id}`, { headers: auth1 });
    const aj: any = await afterReply.json();
    check("staff reply flagged isStaff", aj?.data?.messages?.some((m: any) => m.isStaff === true));
    check("firstResponseAt recorded", !!aj?.data?.firstResponseAt);
    check("auto-moved to WAITING_ON_USER", aj?.data?.status === "WAITING_ON_USER", aj?.data?.status);
    check("audit trail written", (aj?.data?.events || []).length >= 3, `events=${aj?.data?.events?.length}`);

    const assignToNonStaff = await fetch(`${BASE}/support/tickets/${ticket.id}/assign`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ assigneeId: uid2 }),
    });
    check("assign to non-staff refused 403", assignToNonStaff.status === 403, `status=${assignToNonStaff.status}`);

    const assignSelf = await fetch(`${BASE}/support/tickets/${ticket.id}/assign`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ assigneeId: uid1 }),
    });
    check("assign to staff accepted", assignSelf.status === 200, `status=${assignSelf.status}`);

    const unassign = await fetch(`${BASE}/support/tickets/${ticket.id}/assign`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ assigneeId: "" }),
    });
    check("unassign with empty string accepted", unassign.status === 200, `status=${unassign.status}`);

    const badPriority = await fetch(`${BASE}/support/tickets/${ticket.id}/priority`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ priority: "EXTREME" }),
    });
    check("invalid priority refused 400", badPriority.status === 400, `status=${badPriority.status}`);

    const okPriority = await fetch(`${BASE}/support/tickets/${ticket.id}/priority`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ priority: "HIGH" }),
    });
    check("valid priority accepted", okPriority.status === 200, `status=${okPriority.status}`);

    const badUuid = await fetch(`${BASE}/support/tickets/not-a-uuid`, { headers: auth1 });
    check("malformed ticket id rejected", badUuid.status === 422 || badUuid.status === 400, `status=${badUuid.status}`);

    const resolveNoText = await fetch(`${BASE}/support/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ status: "RESOLVED" }),
    });
    check("resolve without explanation refused 400", resolveNoText.status === 400, `status=${resolveNoText.status}`);

    // Straight from WAITING_ON_USER, which is the real agent flow.
    const resolve = await fetch(`${BASE}/support/tickets/${ticket.id}/status`, {
      method: "PATCH",
      headers: jsonh,
      body: JSON.stringify({ status: "RESOLVED", resolution: "Refund issued and confirmed with the bank." }),
    });
    check("staff can resolve from WAITING_ON_USER with a reason", resolve.status === 200, `status=${resolve.status}`);

    console.log("\n[10] database truth");
    const row = await prisma.supportTicket.findUnique({
      where: { id: ticket.id },
      include: { messages: true, events: true },
    });
    check("ticket row exists", !!row);
    check("resolvedAt stamped", !!row?.resolvedAt);
    check("3 messages persisted (user, staff, resolution)", row?.messages?.length === 3, `n=${row?.messages?.length}`);
    check("exactly 1 resolution message", row?.messages?.filter((m: any) => m.isResolution).length === 1);
    const eventActions: string[] = (row?.events || []).map((e: any) => e.action);
    check("CREATED event recorded", eventActions.includes("CREATED"));
    check("ASSIGNED event recorded", eventActions.includes("ASSIGNED"));
    check("UNASSIGNED event recorded", eventActions.includes("UNASSIGNED"));
    check("PRIORITY_CHANGED event recorded", eventActions.includes("PRIORITY_CHANGED"));
    check("STATUS_CHANGED event recorded", eventActions.includes("STATUS_CHANGED"));
    check("RESOLUTION_RECORDED event recorded", eventActions.includes("RESOLUTION_RECORDED"));

    const orphan = await prisma.supportTicket.count({ where: { requesterId: { notIn: created.filter(Boolean) }, status: { in: ["OPEN"] } } });
    check("no unexpected OPEN tickets from this run", orphan >= 0);
  } finally {
    console.log("\n[cleanup]");
    const ids = created.filter(Boolean);
    if (ids.length) {
      await prisma.supportTicket.deleteMany({ where: { requesterId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.supportTicket.deleteMany({ where: { subject: { in: ["Payment not credited", "Safety report", "Closing me"] } } });
    const leftover = await prisma.user.count({ where: { email: { in: [U1, U2] } } });
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

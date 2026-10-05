/**
 * Live end-to-end check for the partner and admin agent tools.
 *
 * Runs against a real server on a real database. Nothing is stubbed: the users
 * are provisioned through Prisma, authenticated through POST /api/auth/login,
 * and every tool is driven through the public /api/agent/* endpoints. That is the
 * point — the unit tests mock Prisma, so only this can catch a tool that is
 * registered but never reachable, a grant that resolves differently against a
 * real AdminUser row, or a confirmation token the HTTP layer will not carry.
 *
 * Usage:  npx tsx tests/agent-tool-e2e.ts [--base http://localhost:5000]
 *
 * Exits non-zero on the first failure. Cleans up every row it created.
 */

import bcrypt from "bcryptjs";
import { prisma } from "../src/config/database";

const BASE = (() => {
  const i = process.argv.indexOf("--base");
  return i > -1 ? process.argv[i + 1] : "http://localhost:5000";
})();

const created = {
  userIds: [] as string[],
  adminUserIds: [] as string[],
  roleIds: [] as string[],
};

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail !== undefined) {
      console.log(`        ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    }
  }
}

async function api(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {}
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/**
 * Asks the agent a question. The agent calls a real hosted model, so a single
 * upstream hiccup must not masquerade as a product failure: a transient
 * provider error is retried, while a real refusal or denial is returned as-is.
 */
async function ask(message: string, token: string): Promise<any> {
  let last: any = null;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await api("/api/agent/ask", { method: "POST", token, body: { message } });
    if (res.status !== 200) {
      throw new Error(`ask(${message}) -> ${res.status} ${JSON.stringify(res.body)}`);
    }
    const turn = res.body;
    last = turn;
    const code = turn?.data?.error?.code;
    if (!code) return turn;
    // The provider meters input tokens per minute, and a turn can cost several
    // thousand. Wait out the window rather than treating it as a failure.
    const wait = code === "AI_RATE_LIMITED" ? 30000 : 4000 * attempt;
    console.log(`    (${code} on attempt ${attempt}; waiting ${wait / 1000}s)`);
    await new Promise((r) => setTimeout(r, wait));
  }
  return last;
}

/** Finds the activity entry for a tool name in an agent turn. */
function activityFor(turn: any, toolName: string): any | undefined {
  const activities: any[] = turn?.data?.toolActivity ?? [];
  return activities.find((a) => a.toolName === toolName);
}

/** The pending confirmation the model asked the user to approve, if any. */
function confirmationFor(turn: any, toolName: string): any | undefined {
  const pending: any[] = turn?.data?.awaitingConfirmation ?? [];
  return pending.find((c) => c.toolName === toolName) ?? pending[0];
}

// --- fixtures ---------------------------------------------------------------

async function createUser(role: string, label: string): Promise<{ id: string; email: string }> {
  const stamp = Date.now().toString(36);
  const email = `${label}.${stamp}@agenttools.nubra.app`;
  const user = await prisma.user.create({
    data: {
      email,
      phone: `+9198${stamp.padStart(8, "0").slice(-8)}`,
      passwordHash: await bcrypt.hash("AgentTools!2026", 10),
      fullName: `Agent ${label}`,
      dateOfBirth: new Date("1995-06-15"),
      role,
      status: "ACTIVE",
      emailVerified: true,
      mobileVerified: true,
    },
    select: { id: true, email: true },
  });
  created.userIds.push(user.id);
  return user;
}

async function createAdmin(
  role: string,
  permissions: string[],
  label: string
): Promise<{ id: string; email: string; token: string }> {
  // A role named after the permission set would rewrite a real role template
  // that already exists. Create a throwaway role instead and always delete it.
  const adminRole = await prisma.adminRole.create({
    data: {
      name: `E2E_${role}_${Date.now().toString(36)}`,
      displayName: `E2E ${role}`,
      description: "Ephemeral role created by the agent tool E2E run.",
      permissions: JSON.stringify(permissions),
      isSystem: false,
    },
    select: { id: true },
  });
  created.roleIds.push(adminRole.id);

  const user = await createUser(role, label);
  const adminUser = await prisma.adminUser.create({
    data: {
      userId: user.id,
      roleId: adminRole.id,
      // Per-account override, so the grant under test is this row's own and not
      // the role template.
      permissions: JSON.stringify(permissions),
    },
    select: { id: true },
  });
  created.adminUserIds.push(adminUser.id);

  return { ...user, token: await login(user.email) };
}

async function login(email: string): Promise<string> {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: { email, password: "AgentTools!2026" },
  });
  if (res.status !== 200) {
    throw new Error(`login(${email}) -> ${res.status} ${JSON.stringify(res.body)}`);
  }
  const token: string | undefined = res.body?.data?.token ?? res.body?.data?.accessToken;
  if (!token) throw new Error(`login(${email}) returned no token: ${JSON.stringify(res.body)}`);
  return token;
}

/** A partner the agent will actually accept work from. */
async function provisionPartner() {
  const user = await createUser("PARTNER", "walker");

  await prisma.walkingPartner.create({
    data: {
      userId: user.id,
      status: "APPROVED",
      rating: 4.7,
      totalWalks: 12,
      totalEarnings: 6400,
      upiId: "walker@okaxis",
      bankAccountName: "Agent Walker",
      bankAccountNumber: "411111111111",
      bankIfsc: "HDFC0000123",
    },
  });
  await prisma.verification.create({
    data: { userId: user.id, status: "APPROVED" },
  });
  await prisma.wallet.create({
    data: { userId: user.id, balance: 8000, promotionalBalance: 0, heldBalance: 0 },
  });
  await prisma.partnerEarnings.create({
    data: {
      userId: user.id,
      todayEarnings: 300,
      weeklyEarnings: 1200,
      monthlyEarnings: 4600,
      lifetimeEarnings: 6400,
      pendingEarnings: 0,
      withdrawableBalance: 8000,
      completedJobs: 12,
      cancelledJobs: 0,
      averageRating: 4.7,
    },
  });

  return { ...user, token: await login(user.email) };
}

// --- the run ----------------------------------------------------------------

async function main() {
  console.log(`\nAgent tool E2E against ${BASE}\n`);

  const health = await api("/health");
  if (health.status !== 200) {
    throw new Error(`server not healthy at ${BASE}: ${health.status}`);
  }

  const partner = await provisionPartner();
  const finance = await createAdmin(
    "FINANCE",
    ["ANALYTICS.VIEW", "USERS.VIEW", "WITHDRAWALS.VIEW", "WITHDRAWALS.APPROVE"],
    "finance"
  );
  const support = await createAdmin("SUPPORT", ["ANALYTICS.VIEW", "USERS.VIEW"], "support");

  // --- partner tools ---
  console.log("partner tools");

  const earnings = await ask("How much have I earned and how much can I withdraw?", partner.token);
  const earningsTool = activityFor(earnings, "get_my_earnings");
  check("get_my_earnings ran for a partner", Boolean(earningsTool), earnings?.data?.message);
  check(
    "get_my_earnings returned the seeded lifetime figure",
    (earningsTool?.data as any)?.lifetime === 6400,
    earningsTool?.data
  );

  const status = await ask("Am I approved as a partner and can I accept walks?", partner.token);
  const statusTool = activityFor(status, "get_my_partner_status");
  check("get_my_partner_status ran", Boolean(statusTool), status?.data?.message);
  check(
    "get_my_partner_status reports APPROVED with no blockers",
    (statusTool?.data as any)?.status === "APPROVED" && (statusTool?.data as any)?.canAcceptWalks === true,
    statusTool?.data
  );

  const emptyQueue = await ask("Show my withdrawal requests.", partner.token);
  const queueTool = activityFor(emptyQueue, "get_my_withdrawals");
  check("get_my_withdrawals ran", Boolean(queueTool), emptyQueue?.data?.message);

  // --- partner withdrawal: confirm, then settle ---
  console.log("\npartner withdrawal (money out)");
  const withdrawAsk = await ask(
    "I want to withdraw 1500 to my saved UPI ID.",
    partner.token
  );
  const withdrawActivity = activityFor(withdrawAsk, "request_withdrawal");
  check("request_withdrawal ran", Boolean(withdrawActivity), withdrawAsk?.data?.message);

  const withdrawConfirmation = confirmationFor(withdrawAsk, "request_withdrawal");
  check(
    "request_withdrawal asked for confirmation",
    withdrawActivity?.status === "confirmation_required" && Boolean(withdrawConfirmation?.token),
    { activity: withdrawActivity, confirmation: withdrawConfirmation }
  );
  check(
    "the confirmation names the amount",
    String(withdrawConfirmation?.summary ?? "").includes("1500"),
    withdrawConfirmation?.summary
  );

  const openRequests = await prisma.withdrawalRequest.count({ where: { userId: partner.id } });
  check("no withdrawal was created before confirmation", openRequests === 0, { openRequests });

  const token: string | undefined = withdrawConfirmation?.token;
  if (!token) throw new Error(`no confirmation token returned: ${JSON.stringify(withdrawActivity)}`);

  const confirm = await api("/api/agent/confirm", {
    method: "POST",
    token: partner.token,
    body: { toolName: "request_withdrawal", confirmationToken: token },
  });
  check("confirm returned 200", confirm.status === 200, confirm);

  const createdRequest = await prisma.withdrawalRequest.findFirst({
    where: { userId: partner.id },
    select: { id: true, amount: true, status: true, method: true, accountDetail: true },
  });
  check("the withdrawal row exists", Boolean(createdRequest), createdRequest);
  check("it holds the confirmed amount", Number(createdRequest?.amount) === 1500, createdRequest);
  check("it is pending, not paid", createdRequest?.status === "PENDING", createdRequest);
  check(
    "it reused the saved UPI destination",
    String(createdRequest?.accountDetail).includes("walker@okaxis"),
    createdRequest
  );

  const walletAfterHold = await prisma.wallet.findUnique({
    where: { userId: partner.id },
    select: { balance: true },
  });
  check("the balance was debited by the hold", Number(walletAfterHold?.balance) === 6500, walletAfterHold);

  // Replay must be refused.
  const replay = await api("/api/agent/confirm", {
    method: "POST",
    token: partner.token,
    body: { toolName: "request_withdrawal", confirmationToken: token },
  });
  check("a replayed confirmation token is refused", replay.status >= 400, replay);

  // A second withdrawal while one is open must be refused by the service.
  const second = await ask("Withdraw 500 more to my saved UPI ID.", partner.token);
  const secondActivity = activityFor(second, "request_withdrawal");
  const secondText = JSON.stringify(secondActivity ?? {});
  check(
    "a second concurrent withdrawal is refused",
    secondActivity?.status === "denied" ||
      secondActivity?.status === "failed" ||
      secondText.includes("DUPLICATE_WITHDRAWAL") ||
      secondText.includes("already"),
    secondActivity
  );

  // --- admin grants ---
  console.log("\nadmin tools and delegation");

  const stats = await ask("How many users and pending withdrawals are there?", finance.token);
  const statsTool = activityFor(stats, "admin_get_platform_stats");
  check("finance admin got platform stats", Boolean(statsTool), stats?.data?.message);

  const supportDenied = await ask("How many users and pending withdrawals are there?", support.token);
  const supportStats = activityFor(supportDenied, "admin_get_platform_stats");
  check(
    "support admin with ANALYTICS.VIEW also got stats",
    Boolean(supportStats),
    supportDenied?.data?.message
  );

  // A grant-less admin must be denied, not silently given nothing.
  const noGrant = await createAdmin("MARKETING_ADMIN", ["OFFERS.VIEW"], "marketing");
  const denied = await ask("How many users and pending withdrawals are there?", noGrant.token);
  const deniedTool = activityFor(denied, "admin_get_platform_stats");
  check(
    "an admin without ANALYTICS.VIEW is denied the stats tool",
    deniedTool?.status === "denied",
    deniedTool
  );
  created.userIds.push(noGrant.id);

  // SUPPORT is deliberately not on the money tool's role list.
  const supportMoney = await ask("Approve the pending withdrawal 12345.", support.token);
  check(
    "support admin was not offered the approve tool",
    !activityFor(supportMoney, "admin_approve_withdrawal"),
    supportMoney
  );

  const supportList = await ask("List pending withdrawals.", support.token);
  check(
    "support admin was not offered the withdrawal queue",
    !activityFor(supportList, "admin_list_withdrawals"),
    supportList
  );

  // The find-user tool should work for both, since both hold USERS.VIEW.
  const findForSupport = await ask(`Look up user ${partner.email}.`, support.token);
  check(
    "support admin can look up a user",
    Boolean(activityFor(findForSupport, "admin_find_user")),
    findForSupport?.data?.message
  );

  // --- finance approves ---
  console.log("\nfinance approves the payout");
  const queue = await ask("List pending withdrawals.", finance.token);
  const financeQueueTool = activityFor(queue, "admin_list_withdrawals");
  check("finance admin got the withdrawal queue", Boolean(financeQueueTool), queue?.data?.message);
  check(
    "an approver sees the full destination",
    String((financeQueueTool?.data as any)?.destinationVisible) === "true",
    financeQueueTool?.data
  );

  const approveAsk = await ask(
    `Approve the pending withdrawal ${createdRequest!.id}.`,
    finance.token
  );
  const approveActivity = activityFor(approveAsk, "admin_approve_withdrawal");
  const approveConfirmation = confirmationFor(approveAsk, "admin_approve_withdrawal");
  check("approve asked for confirmation", Boolean(approveConfirmation?.token), approveActivity);

  const approveToken: string | undefined = approveConfirmation?.token;
  if (!approveToken) throw new Error(`no admin confirmation token: ${JSON.stringify(approveActivity)}`);

  const beforeApprove = await prisma.withdrawalRequest.findFirst({
    where: { userId: partner.id },
    select: { id: true, status: true },
  });
  check("still pending before approval", beforeApprove?.status === "PENDING", beforeApprove);

  const approve = await api("/api/agent/confirm", {
    method: "POST",
    token: finance.token,
    body: { toolName: "admin_approve_withdrawal", confirmationToken: approveToken },
  });
  check("approve returned 200", approve.status === 200, approve);

  const afterApprove = await prisma.withdrawalRequest.findUnique({
    where: { id: beforeApprove!.id },
    select: { status: true, reviewedBy: true },
  });
  check("the request is now APPROVED", afterApprove?.status === "APPROVED", afterApprove);

  const earningsAfter = await prisma.partnerEarnings.findUnique({
    where: { userId: partner.id },
    select: { withdrawableBalance: true },
  });
  check(
    "PartnerEarnings.withdrawableBalance settled down by the payout",
    Number(earningsAfter?.withdrawableBalance) === 6500,
    earningsAfter
  );

  // Approving twice must not move money again.
  const approveReplay = await api("/api/agent/confirm", {
    method: "POST",
    token: finance.token,
    body: { toolName: "admin_approve_withdrawal", confirmationToken: approveToken },
  });
  check("a replayed approve token is refused", approveReplay.status >= 400, approveReplay);

  const balanceAfter = await prisma.wallet.findUnique({
    where: { userId: partner.id },
    select: { balance: true },
  });
  check("the balance moved exactly once", Number(balanceAfter?.balance) === 6500, balanceAfter);

  // --- audit trail ---
  console.log("\naudit trail");
  const audit = await prisma.auditLog.findMany({
    // Agent rows are stored in AuditLog with the tool name in entityId and the
    // detail in metadata; the actor is the account that requested the action.
    where: { actorId: { in: [partner.id, finance.id, support.id] }, entityType: "AgentTool" },
    select: { entityId: true, action: true, actorType: true, metadata: true },
    orderBy: { createdAt: "asc" },
  });
  const names = new Set(audit.map((a: any) => a.entityId).filter(Boolean));
  for (const expected of [
    "get_my_earnings",
    "get_my_partner_status",
    "request_withdrawal",
    "admin_get_platform_stats",
    "admin_approve_withdrawal",
  ]) {
    check(`audit logged ${expected}`, names.has(expected), [...names]);
  }
  check(
    "admin tool calls are flagged as admin actions",
    audit.some((a: any) => a.actorType === "ADMIN"),
    audit.filter((a: any) => a.actorType === "ADMIN")
  );

  // --- capabilities per role ---
  console.log("\ncapabilities");
  const userCaps = await api("/api/agent/capabilities", { token: partner.token });
  const supportCaps = await api("/api/agent/capabilities", { token: support.token });
  const supportNames: string[] = (supportCaps.body?.data?.tools ?? []).map((t: any) => t.name);
  const partnerNames: string[] = (userCaps.body?.data?.tools ?? []).map((t: any) => t.name);
  check(
    "support admin is not offered the money tools",
    !supportNames.includes("admin_approve_withdrawal") && !supportNames.includes("admin_list_withdrawals"),
    supportNames.filter((n) => n.startsWith("admin_"))
  );
  check(
    "support admin is offered the read tools",
    supportNames.includes("admin_get_platform_stats"),
    supportNames.filter((n) => n.startsWith("admin_"))
  );
  check(
    "a partner is offered the partner tools and no admin tools",
    partnerNames.includes("get_my_earnings") &&
      partnerNames.includes("request_withdrawal") &&
      !partnerNames.some((n) => n.startsWith("admin_")),
    partnerNames
  );
  check("partner capabilities respond", userCaps.status === 200, userCaps.status);
}

async function cleanup(): Promise<void> {
  const userIds = created.userIds;
  if (userIds.length === 0) return;
  // Order matters. AuditLog keys on actorId (SetNull, so it must go first),
  // withdrawals and their ledger rows cascade from the wallet, and the admin
  // rows must go before the roles they point at.
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } }),
    prisma.withdrawalRequest.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.transaction.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.partnerEarnings.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.wallet.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.verification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.walkingPartner.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.adminUser.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.user.deleteMany({ where: { id: { in: userIds } } }),
    prisma.adminRole.deleteMany({ where: { id: { in: created.roleIds } } }),
  ]);
}

main()
  .then(async () => {
    await cleanup();
    console.log(`\n${checks - failures}/${checks} checks passed.`);
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("\nE2E run aborted:", err);
    try {
      await cleanup();
    } catch (cleanupErr) {
      console.error("cleanup failed:", cleanupErr);
    }
    process.exit(1);
  });
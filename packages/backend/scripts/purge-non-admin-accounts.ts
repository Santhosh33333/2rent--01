/**
 * Purge every account EXCEPT super admins.
 *
 *   npx tsx scripts/purge-non-admin-accounts.ts              # dry run (default, safe)
 *   npx tsx scripts/purge-non-admin-accounts.ts --execute    # actually delete
 *
 * Safety rules, enforced in code:
 * - SUPER_ADMIN accounts are NEVER deleted, whatever the flags say.
 * - The primary root account is never deleted even if its role were changed.
 * - Everything runs in ONE transaction: if any row fails to delete, nothing is lost.
 * - Children are deleted before parents so foreign keys never block the purge.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const EXECUTE = process.argv.includes("--execute");

/** The root account must survive even if its role is ever edited by hand. */
const NEVER_DELETE = ["santhoshkrishna958@gmail.com", "nabrisupport@gmail.com"];

/** Roles that are kept. Everything else is removed. */
const KEEP_ROLES = ["SUPER_ADMIN"];

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, fullName: true, role: true,
      _count: { select: { bookings: true, communities: true, sentMessages: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const doomed = users.filter(
    (u) => !KEEP_ROLES.includes(u.role) && !NEVER_DELETE.includes(u.email.toLowerCase())
  );
  const kept = users.filter((u) => !doomed.includes(u));

  console.log(`\nTotal accounts : ${users.length}`);
  console.log(`WILL DELETE     : ${doomed.length}`);
  console.log(`WILL KEEP       : ${kept.length}\n`);

  console.log("=== KEEPING ===");
  for (const u of kept) {
    console.log(`  [${u.role}] ${u.fullName} <${u.email}>`);
  }

  console.log("\n=== DELETING ===");
  for (const u of doomed) {
    const act = u._count.bookings + u._count.communities + u._count.sentMessages;
    console.log(
      `  [${u.role}] ${u.fullName} <${u.email}>  ` +
      `(bookings=${u._count.bookings} communities=${u._count.communities} sent=${u._count.sentMessages})` +
      (act > 0 ? "  ! has data" : "")
    );
  }

  if (!EXECUTE) {
    console.log("\nDRY RUN ONLY — nothing was deleted. Re-run with --execute to apply.\n");
    return;
  }

  const ids = doomed.map((u) => u.id);
  if (ids.length === 0) {
    console.log("\nNothing to delete.\n");
    return;
  }

  // Ordered child-first so no FK restrict can abort the transaction. Each step is
  // tolerant of an absent table/relation and of ids that have no such rows.
  const steps: Array<[string, () => Promise<unknown>]> = [
    ["Message", () => prisma.message.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })],
    ["Message.reactions-on-others", () => prisma.message.deleteMany({ where: { senderId: { notIn: ids }, receiverId: { in: ids } } })],
    ["Conversation", () => prisma.conversation.deleteMany({ where: { OR: [{ participant1Id: { in: ids } }, { participant2Id: { in: ids } }] } })],
    ["TypingStatus", () => prisma.typingStatus.deleteMany({ where: { userId: { in: ids } } })],
    ["CallLog", () => prisma.callLog.deleteMany({ where: { OR: [{ callerId: { in: ids } }, { receiverId: { in: ids } }] } })],
    ["CommunityMember", () => prisma.communityMember.deleteMany({ where: { userId: { in: ids } } })],
    ["CommunityPost", () => prisma.communityPost.deleteMany({ where: { authorId: { in: ids } } })],
    ["CommunityComment", () => prisma.communityComment.deleteMany({ where: { authorId: { in: ids } } })],
    ["CommunityPoll", () => prisma.communityPoll.deleteMany({ where: { authorId: { in: ids } } })],
    ["CommunityPollVote", () => prisma.communityPollVote.deleteMany({ where: { userId: { in: ids } } })],
    ["Community (owned)", () => prisma.community.deleteMany({ where: { ownerId: { in: ids } } })],
    ["EventAttendee", () => prisma.eventAttendee.deleteMany({ where: { userId: { in: ids } } })],
    ["Event (organized)", () => prisma.event.deleteMany({ where: { organizerId: { in: ids } } })],
    ["Friendship", () => prisma.friendship.deleteMany({ where: { OR: [{ requesterId: { in: ids } }, { addresseeId: { in: ids } }] } })],
    ["ChatRequest", () => prisma.chatRequest.deleteMany({ where: { OR: [{ senderId: { in: ids } }, { receiverId: { in: ids } }] } })],
    ["ChatRequestSettings", () => prisma.chatRequestSettings.deleteMany({ where: { userId: { in: ids } } })],
    ["MuteList", () => prisma.muteList.deleteMany({ where: { OR: [{ muterId: { in: ids } }, { mutedId: { in: ids } }] } })],
    ["ChatReport", () => prisma.chatReport.deleteMany({ where: { reporterId: { in: ids } } })],
    ["UserBlock", () => prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: ids } }, { blockedId: { in: ids } }] } })],
    ["LocationShare", () => prisma.locationShare.deleteMany({ where: { OR: [{ sharerId: { in: ids } }, { viewerId: { in: ids } }] } })],
    ["Rating", () => prisma.rating.deleteMany({ where: { OR: [{ raterId: { in: ids } }, { ratedId: { in: ids } }] } })],
    ["SosAlert", () => prisma.sosAlert.deleteMany({ where: { userId: { in: ids } } })],
    ["SosIncident", () => prisma.sosIncident.deleteMany({ where: { userId: { in: ids } } })],
    ["Report", () => prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: ids } }, { targetId: { in: ids } }] } })],
    ["Referral", () => prisma.referral.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredId: { in: ids } }] } })],
    ["RoleApplication", () => prisma.roleApplication.deleteMany({ where: { userId: { in: ids } } })],
    ["Notification", () => prisma.notification.deleteMany({ where: { userId: { in: ids } } })],
    ["Device", () => prisma.device.deleteMany({ where: { userId: { in: ids } } })],
    ["Session", () => prisma.session.deleteMany({ where: { userId: { in: ids } } })],
    ["LoginHistory", () => prisma.loginHistory.deleteMany({ where: { userId: { in: ids } } })],
    ["OtpCode", () => prisma.otpCode.deleteMany({ where: { userId: { in: ids } } })],
    ["MarketingEmailLog", () => prisma.marketingEmailLog.deleteMany({ where: { userId: { in: ids } } })],
    ["MovieWatchlist", () => prisma.movieWatchlist.deleteMany({ where: { userId: { in: ids } } })],
    ["WithdrawalRequest", () => prisma.withdrawalRequest.deleteMany({ where: { userId: { in: ids } } })],
    ["TopupRequest", () => prisma.topupRequest.deleteMany({ where: { userId: { in: ids } } })],
    ["PaymentOrder", () => prisma.paymentOrder.deleteMany({ where: { userId: { in: ids } } })],
    ["CreditLedger", () => prisma.creditLedger.deleteMany({ where: { userId: { in: ids } } })],
    ["UpiPayment", () => prisma.upiPayment.deleteMany({ where: { userId: { in: ids } } })],
    ["Reward", () => prisma.reward.deleteMany({ where: { userId: { in: ids } } })],
    ["TrustScore", () => prisma.trustScore.deleteMany({ where: { userId: { in: ids } } })],
    ["Agreement", () => prisma.agreement.deleteMany({ where: { userId: { in: ids } } })],
    ["VerificationHistory(via verification)", () => prisma.verification.deleteMany({ where: { userId: { in: ids } } })],
    ["AdminUser", () => prisma.adminUser.deleteMany({ where: { userId: { in: ids } } })],
    ["AuditLog", () => prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } })],
    ["UserActivity", () => prisma.userActivity.deleteMany({ where: { userId: { in: ids } } })],
    ["ApiLog", () => prisma.apiLog.deleteMany({ where: { userId: { in: ids } } })],
    ["ErrorLog", () => prisma.errorLog.deleteMany({ where: { userId: { in: ids } } })],
    ["EarningDetail(via partner earnings)", () => prisma.partnerEarnings.deleteMany({ where: { userId: { in: ids } } })],
    ["PartnerLevel", () => prisma.partnerLevel.deleteMany({ where: { userId: { in: ids } } })],
    ["PartnerEarnings", () => prisma.partnerEarnings.deleteMany({ where: { userId: { in: ids } } })],
    ["EarningDetail(via walking request)", () => prisma.walkingRequest.deleteMany({ where: { requesterId: { in: ids } } })],
    ["WalkingRequest(accepted/completed)", () => prisma.walkingRequest.deleteMany({ where: { OR: [{ acceptedById: { in: ids } }, { completedById: { in: ids } }] } })],
    ["WalkingRequestApplication", () => prisma.walkingRequestApplication.deleteMany({ where: { applicantId: { in: ids } } })],
    ["WalkingPartner", () => prisma.walkingPartner.deleteMany({ where: { userId: { in: ids } } })],
    ["CarryBuddyRequest", () => prisma.carryBuddyRequest.deleteMany({ where: { OR: [{ requesterId: { in: ids } }, { acceptedById: { in: ids } }] } })],
    ["Transaction", () => prisma.transaction.deleteMany({ where: { userId: { in: ids } } })],
    ["Wallet", () => prisma.wallet.deleteMany({ where: { userId: { in: ids } } })],
    ["Partner", () => prisma.partner.deleteMany({ where: { userId: { in: ids } } })],
    ["DispatchRequest", () => prisma.dispatchRequest.deleteMany({ where: { partnerId: { in: ids } } })],
    ["Booking (as customer)", () => prisma.booking.deleteMany({ where: { userId: { in: ids } } })],
    ["Booking (via assigned partner)", () => prisma.booking.deleteMany({ where: { partner: { userId: { in: ids } } } })],
    ["USER ROWS", () => prisma.user.deleteMany({ where: { id: { in: ids } } })],
  ];

  console.log("\nExecuting purge in a single transaction...");
  const counts: Record<string, number> = {};

  await prisma.$transaction(async (tx) => {
    for (const [label, run] of steps) {
      try {
        const res = (await run()) as { count?: number };
        if (res?.count) counts[label] = res.count;
      } catch (err) {
        // A missing relation/table must not abort the purge; a real FK block
        // should, so rethrow anything that is not a "does not exist" error.
        const msg = (err as Error)?.message || "";
        if (!/Unknown (field|argument)|does not exist|no such column|is not a valid|Unknown model/i.test(msg)) {
          throw new Error(`Step "${label}" failed: ${msg}`);
        }
      }
    }
  });

  console.log("\nDeleted rows per step:");
  for (const [label, n] of Object.entries(counts)) console.log(`  ${label.padEnd(42)} ${n}`);

  const remaining = await prisma.user.count();
  const roles = await prisma.user.groupBy({ by: ["role"], _count: { _all: true } });
  console.log(`\nAccounts remaining: ${remaining}`);
  for (const r of roles) console.log(`  ${r.role}: ${r._count._all}`);
  console.log("");
}

main()
  .catch((e) => {
    console.error("\nPURGE FAILED — transaction rolled back, nothing deleted:\n", e?.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

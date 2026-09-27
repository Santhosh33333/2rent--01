/** Pre-purge safety check: what does the KEPT super admin own, and would the
 *  purge destroy any of it? Read-only. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const keepEmails = ["santhoshkrishna958@gmail.com", "nabrisupport@gmail.com"];
  const keepers = await prisma.user.findMany({
    where: { email: { in: keepEmails } },
    select: { id: true, email: true, role: true },
  });
  const keeperIds = keepers.map((k) => k.id);
  const doomed = await prisma.user.findMany({
    where: { role: { not: "SUPER_ADMIN" }, email: { notIn: keepEmails } },
    select: { id: true },
  });
  const doomedIds = doomed.map((d) => d.id);

  console.log("KEEPERS:", keepers.map((k) => `${k.email} (${k.role})`).join(", ") || "(none)");

  const asCustomer = await prisma.booking.findMany({
    where: { userId: { in: keeperIds } },
    select: { id: true, status: true, partner: { select: { userId: true } } },
  });
  const atRisk = asCustomer.filter((b) => b.partner && doomedIds.includes(b.partner.userId));
  console.log(`\nBookings owned by keeper as customer : ${asCustomer.length}`);
  console.log(`  of those, assigned to a DOOMED partner: ${atRisk.length}  <-- would be deleted by purge`);

  const communities = await prisma.community.findMany({
    where: { ownerId: { in: keeperIds } },
    select: { id: true, name: true, _count: { select: { members: true } } },
  });
  console.log(`\nCommunities owned by keeper           : ${communities.length}`);
  for (const c of communities) {
    const doomedMembers = await prisma.communityMember.count({
      where: { communityId: c.id, userId: { in: doomedIds } },
    });
    console.log(`  "${c.name}" members=${c._count.members} (doomed members: ${doomedMembers}, will be removed but community kept)`);
  }

  const wallet = await prisma.wallet.findMany({
    where: { userId: { in: keeperIds } },
    select: { userId: true, balance: true, promotionalBalance: true },
  });
  console.log(`\nKeeper wallet(s):`, wallet.map((w) => `bal=${w.balance} promo=${w.promotionalBalance}`).join(", ") || "(none)");

  const orphanCheck = await prisma.community.count({ where: { ownerId: { in: doomedIds } } });
  console.log(`\nCommunities owned by doomed users (deleted): ${orphanCheck}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());

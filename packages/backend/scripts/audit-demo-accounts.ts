/**
 * Read-only audit: list every account that looks like a demo / test / AI
 * placeholder so a human can confirm before anything is deleted. Makes NO
 * changes. Run with: npx tsx scripts/audit-demo-accounts.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const PROTECTED = ["santhoshkrishna958@gmail.com", "nabrisupport@gmail.com"];

const DEMO_DOMAIN = /@sidebud\.demo$/i;
const TEST_DOMAIN = /@test\.local$/i;
const EXAMPLE_DOMAIN = /@example\.(com|org|net)$/i;
const AI_NAME = /\b(demo|test|admin|user|john|doe|jane|asdf|qwerty|lorem|ipsum|temp|tmp|sample|placeholder|bot|ai)\b/i;

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true, email: true, fullName: true, role: true, status: true,
      phone: true, createdAt: true,
      _count: { select: { bookings: true, communities: true, sentMessages: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const reasons = (u: (typeof users)[number]) => {
    const r: string[] = [];
    const email = u.email.toLowerCase();
    if (DEMO_DOMAIN.test(email)) r.push("demo-domain(@sidebud.demo)");
    if (TEST_DOMAIN.test(email)) r.push("test-domain(@test.local)");
    if (EXAMPLE_DOMAIN.test(email)) r.push("example-domain");
    if (AI_NAME.test(u.fullName ?? "")) r.push(`ai-ish-name("${u.fullName}")`);
    if (PROTECTED.includes(email)) r.push("PROTECTED-DO-NOT-TOUCH");
    return r;
  };

  const flagged = users.map((u) => ({ u, r: reasons(u) })).filter((x) => x.r.length > 0);

  console.log(`\nTotal accounts: ${users.length}\n`);
  console.log("=== FLAGGED AS DEMO / TEST / AI ===");
  for (const { u, r } of flagged) {
    const data = u._count.bookings + u._count.sentMessages + u._count.communities;
    console.log(
      `${r.join(" | ")}\n  ${u.email}  "${u.fullName}" role=${u.role} status=${u.status}\n` +
      `  id=${u.id} created=${u.createdAt.toISOString()}\n` +
      `  activity: bookings=${u._count.bookings} sent=${u._count.sentMessages} communities=${u._count.communities}` +
      (data > 0 ? "   <-- HAS REAL ACTIVITY, REVIEW CAREFULLY" : "") + "\n"
    );
  }
  if (flagged.length === 0) console.log("(none)\n");

  console.log("=== ALL ACCOUNTS (name / role / email) ===");
  for (const u of users) {
    console.log(`  ${u.role.padEnd(22)} ${(u.fullName ?? "").padEnd(28)} ${u.email}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const b64 = fs.readFileSync("C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64", "utf8").trim();
const dbUrl = Buffer.from(b64, "base64").toString("utf8");
process.env.DATABASE_URL = dbUrl;

const prisma = new PrismaClient();

async function main() {
  const admins = await prisma.user.findMany({
    where: { OR: [{ role: { in: ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"] } }, { activeRole: { in: ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"] } }] },
    select: { id: true, email: true, phone: true, role: true, activeRole: true, status: true, emailVerified: true, mobileVerified: true },
  });
  console.log(`\nAdmin-tier users in PROD DB: ${admins.length}`);
  for (const a of admins) {
    const au = await prisma.adminUser.findUnique({ where: { userId: a.id }, select: { id: true, role: { select: { name: true, permissions: true } }, permissions: true } });
    console.log(`- ${a.email} | role=${a.role} activeRole=${a.activeRole} status=${a.status} | adminUser=${au ? "yes" : "NO"}`);
    if (au) console.log(`    roleRow=${au.role?.name} perms=${String(au.permissions || au.role?.permissions || "[]").slice(0, 80)}`);
  }
  const totalUsers = await prisma.user.count();
  console.log(`\nTotal users in PROD DB: ${totalUsers}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
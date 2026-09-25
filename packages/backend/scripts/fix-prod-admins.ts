import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const b64 = fs.readFileSync("C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64", "utf8").trim();
process.env.DATABASE_URL = Buffer.from(b64, "base64").toString("utf8");

const prisma = new PrismaClient();

const ADMIN_ROLES = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT", "FINANCE", "SUPPORT_ADMIN", "FINANCE_ADMIN", "KYC_ADMIN", "MARKETING_ADMIN", "PARTNER_ADMIN"];

async function main() {
  const admins = await prisma.user.findMany({
    where: { OR: [{ role: { in: ADMIN_ROLES } }, { activeRole: { in: ADMIN_ROLES } }] },
    select: { id: true, email: true, phone: true, role: true, activeRole: true, status: true },
  });
  let fixed = 0;
  for (const a of admins) {
    if (ADMIN_ROLES.includes(a.role) && a.activeRole !== a.role) {
      await prisma.user.update({ where: { id: a.id }, data: { activeRole: a.role } });
      console.log(`FIXED ${a.email}: activeRole ${a.activeRole} -> ${a.role}`);
      fixed++;
    } else {
      console.log(`OK     ${a.email}: role=${a.role} activeRole=${a.activeRole}`);
    }
    // Ensure a canonical AdminUser row exists so permission checks resolve.
    const au = await prisma.adminUser.findUnique({ where: { userId: a.id }, select: { id: true } });
    if (!au && ADMIN_ROLES.includes(a.activeRole || "")) {
      const ar = await prisma.adminRole.upsert({
        where: { name: a.activeRole! },
        update: {},
        create: { name: a.activeRole!, displayName: a.activeRole!, permissions: JSON.stringify(a.activeRole === "SUPER_ADMIN" ? ["*"] : []), isSystem: true },
      });
      await prisma.adminUser.create({ data: { userId: a.id, roleId: ar.id, permissions: JSON.stringify(a.activeRole === "SUPER_ADMIN" ? ["*"] : []) } });
      console.log(`CREATED AdminUser row for ${a.email}`);
    }
  }
  console.log(`\n${admins.length} admin-tier users checked, ${fixed} corrected.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
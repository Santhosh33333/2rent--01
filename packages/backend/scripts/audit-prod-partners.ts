import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const b64 = fs.readFileSync("C:\\Users\\acer\\AppData\\Local\\Temp\\opencode\\prod_db.b64", "utf8").trim();
process.env.DATABASE_URL = Buffer.from(b64, "base64").toString("utf8");
const prisma = new PrismaClient();

async function main() {
  const partners = await prisma.partner.findMany({
    select: { userId: true, status: true, providesWalking: true, providesCarry: true, user: { select: { email: true, phone: true, fullName: true, role: true, activeRole: true, status: true } } },
  });
  console.log(`Partners in PROD: ${partners.length}`);
  for (const p of partners) {
    console.log(`- ${p.user.email} (${p.status}) user.role=${p.user.role} activeRole=${p.user.activeRole} acct=${p.user.status}`);
  }
  const approved = partners.filter((p) => p.status === "APPROVED").length;
  const pending = partners.filter((p) => p.status === "PENDING").length;
  console.log(`\nAPPROVED=${approved} PENDING=${pending}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
// Dev-only: approve KYC for chat test account 2.
import { prisma } from "./src/config/database";

async function main() {
  const user = await prisma.user.findUnique({ where: { email: "chattest2@example.com" } });
  if (!user) throw new Error("no user2");
  await prisma.verification.upsert({
    where: { userId: user.id },
    create: { userId: user.id, status: "VERIFIED", reviewedAt: new Date() },
    update: { status: "VERIFIED", reviewedAt: new Date() },
  });
  await prisma.user.update({ where: { id: user.id }, data: { city: "Bengaluru" } });
  console.log("KYC2_OK");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("FAIL", e?.message); process.exit(1); });

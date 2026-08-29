import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email: "santhoshkrishna958@gmail.com" } });
  if (!user) { console.log("User not found"); return; }
  await prisma.partner.update({ where: { userId: user.id }, data: { status: "APPROVED", reviewedAt: new Date() } });
  console.log("Partner APPROVED");
  const partner = await prisma.partner.findUnique({ where: { userId: user.id } });
  console.log("Partner status:", partner?.status, "providesWalking:", partner?.providesWalking);
  await prisma.$disconnect();
})();

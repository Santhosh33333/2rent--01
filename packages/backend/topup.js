import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
(async () => {
  const user = await prisma.user.findUnique({ where: { email: "santhoshkrishna958@gmail.com" } });
  if (!user) { console.log("User not found"); return; }
  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { balance: 10000 },
    create: { userId: user.id, balance: 10000, currency: "INR" },
  });
  await prisma.transaction.create({
    data: { walletId: wallet.id, userId: user.id, type: "CREDIT", status: "COMPLETED", amount: 10000, description: "Admin top-up for testing" },
  });
  console.log("Wallet credited: Rs.10,000");
  await prisma.$disconnect();
})();

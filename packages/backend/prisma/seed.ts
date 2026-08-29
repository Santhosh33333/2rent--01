import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { env } from "../src/config/env";

const prisma = new PrismaClient();

// Never seed fake/dev identifiers into a production database.
if (env.isProduction && !process.env.SEED_FORCE) {
  console.error("[seed] Refusing to run in production. Set SEED_FORCE=1 to override.");
  process.exit(1);
}

async function main(): Promise<void> {
  const adminPasswordHash = await bcrypt.hash(env.ADMIN_PASSWORD ?? "300703Ss", env.BCRYPT_SALT_ROUNDS);

  const adminEmail = env.ADMIN_EMAIL ?? "santhoshkrishna958@gmail.com";
  const adminPhone = "+919999999999";
  const existingAdmin = await prisma.user.findFirst({
    where: { OR: [{ email: adminEmail }, { phone: adminPhone }] },
  });
  const admin = existingAdmin
    ? await prisma.user.update({
        where: { id: existingAdmin.id },
        data: { passwordHash: adminPasswordHash },
      })
    : await prisma.user.create({
        data: {
          email: adminEmail,
          phone: adminPhone,
          passwordHash: adminPasswordHash,
          fullName: env.ADMIN_NAME ?? "Super Admin",
          dateOfBirth: new Date("1990-01-01"),
          gender: "OTHER",
          status: "ACTIVE",
          role: "SUPER_ADMIN",
          activeRole: "SUPER_ADMIN",
          emailVerified: true,
          mobileVerified: true,
        },
      });

  const userPasswordHash = await bcrypt.hash("user123", env.BCRYPT_SALT_ROUNDS);

  // Resolve by email OR phone: a prior run or manual signup may have claimed
  // either unique value — update in place instead of colliding.
  const existingUser = await prisma.user.findFirst({
    where: { OR: [{ email: "user@rentbuddy.app" }, { phone: "+919876543210" }] },
  });
  const user = existingUser
    ? await prisma.user.update({
        where: { id: existingUser.id },
        data: { passwordHash: userPasswordHash },
      })
    : await prisma.user.create({
        data: {
          email: "user@rentbuddy.app",
          phone: "+919876543210",
          passwordHash: userPasswordHash,
          fullName: "Test User",
          dateOfBirth: new Date("1995-06-15"),
          gender: "MALE",
          status: "ACTIVE",
          role: "USER",
          activeRole: "USER",
          emailVerified: true,
          mobileVerified: true,
        },
      });

  await prisma.verification.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      status: "VERIFIED",
      selfieUrl: "https://example.com/selfie.jpg",
      govIdUrl: "https://example.com/govid.jpg",
      govIdType: "AADHAAR",
      addressProofUrl: "https://example.com/address.jpg",
      emergencyContactName: "Emergency Contact",
      emergencyContactPhone: "+919999999999",
      emergencyContactRelation: "Family",
    },
  });

  await prisma.wallet.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      balance: 1500.0,
      currency: "INR",
    },
  });

  await prisma.trustScore.upsert({
    where: { userId: user.id },
    update: {},
    create: {
      userId: user.id,
      score: 85,
    },
  });

  console.log("Seed complete.");
  console.log("Admin:", admin.email, "| Role:", admin.role);
  console.log("User:", user.email);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

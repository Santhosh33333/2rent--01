import { PrismaClient } from "@prisma/client";

/**
 * Seeds subscription plans from the spec defaults. Idempotent: safe to re-run.
 *
 * Prices live here as seed data, not as hardcoded frontend values. Admin can
 * change them later through the plan models; this only establishes the initial
 * configuration (1-day trial, Rs 10 monthly).
 */
const prisma = new PrismaClient();

const PLANS = [
  {
    code: "nabri_monthly",
    name: "Nabri Monthly",
    description: "Full access, billed every 30 days.",
    price: 10,
    currency: "INR",
    durationDays: 30,
    trialDays: 1,
    displayOrder: 1,
    gatewayPlanId: "nabri_monthly",
  },
  {
    code: "nabri_yearly",
    name: "Nabri Yearly",
    description: "Full access, billed once a year.",
    price: 100,
    currency: "INR",
    durationDays: 365,
    trialDays: 1,
    displayOrder: 2,
    // Yearly mandates are not available on UPI Autopay, so this plan is
    // reachable only through card or eNACH.
    gatewayPlanId: "nabri_yearly",
  },
];

async function main() {
  for (const plan of PLANS) {
    await prisma.subscriptionPlan.upsert({
      where: { code: plan.code },
      create: plan,
      update: {
        name: plan.name,
        description: plan.description,
        // price/trialDays intentionally not overwritten: an admin change must
        // survive a re-seed.
        isActive: true,
        displayOrder: plan.displayOrder,
        gatewayPlanId: plan.gatewayPlanId,
      },
    });
    console.log(`[seed-subscriptions] plan ready: ${plan.code}`);
  }
}

main()
  .catch((error) => {
    console.error("[seed-subscriptions] failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
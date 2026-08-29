import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { SERVICE_CATALOG } from "../src/services/serviceCatalog";

config({ path: __dirname + "/../.env" });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  let created = 0;
  let skipped = 0;

  for (const svc of SERVICE_CATALOG) {
    const p = svc.pricing;
    const rows: { key: string; value: string; description: string }[] = [
      { key: `${svc.key}_BASE_FEE`, value: String(p.baseFee), description: `${svc.label} base fee` },
      { key: `${svc.key}_PER_MINUTE_PRICE`, value: String(p.perMinute), description: `${svc.label} per-minute price` },
      { key: `${svc.key}_PER_KM_PRICE`, value: String(p.perKm), description: `${svc.label} per-km price` },
      { key: `${svc.key}_MIN_DURATION_MINUTES`, value: String(p.minDurationMinutes), description: `${svc.label} minimum duration` },
      { key: `${svc.key}_WAITING_CHARGE_PER_MIN`, value: String(p.waitingChargePerMin), description: `${svc.label} waiting charge/min` },
      { key: `${svc.key}_WAITING_FREE_MINUTES`, value: String(p.waitingFreeMinutes), description: `${svc.label} waiting free minutes` },
      { key: `${svc.key}_PLATFORM_FEE_PERCENT`, value: String(p.platformFeePercent), description: `${svc.label} platform fee %` },
      { key: `${svc.key}_SURGE_ENABLED`, value: String(p.surgeEnabled), description: `${svc.label} surge enabled` },
      { key: `${svc.key}_PEAK_HOUR_START`, value: String(p.peakStart), description: `${svc.label} peak start hour` },
      { key: `${svc.key}_PEAK_HOUR_END`, value: String(p.peakEnd), description: `${svc.label} peak end hour` },
      { key: `${svc.key}_PEAK_MULTIPLIER`, value: String(p.peakMultiplier), description: `${svc.label} peak multiplier` },
      { key: `${svc.key}_MIN_BOOKING_AMOUNT`, value: String(p.minBookingAmount), description: `${svc.label} min booking amount` },
    ];

    for (const row of rows) {
      const existing = await prisma.pricingConfig.findUnique({ where: { key: row.key } });
      if (existing) {
        skipped++;
        continue;
      }
      await prisma.pricingConfig.create({
        data: {
          key: row.key,
          value: row.value,
          description: row.description,
          category: "PRICING",
          serviceType: svc.key,
          isActive: true,
        },
      });
      created++;
    }
  }

  console.log(`Service pricing seeded: ${created} created, ${skipped} already present.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

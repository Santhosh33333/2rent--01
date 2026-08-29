const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

// Admin-controlled pricing & fees. Server engines read these keys via
// pricingEngine.getConfig(); defaults here mirror the engine fallbacks.
const SEED = [
  // ---- USER fees ----
  { key: "PLATFORM_FEE_PERCENT", value: "1", category: "USER", label: "User platform fee", unitNote: "% added to service total" },
  { key: "BASE_FEE", value: "50", category: "USER", label: "Base fee (first 30 min)", unitNote: "flat ₹" },
  { key: "PER_MINUTE_AFTER_30", value: "2", category: "USER", label: "Per-minute after 30 min", unitNote: "₹/min" },
  { key: "PEAK_HOUR_MULTIPLIER", value: "1.5", category: "USER", label: "Peak hour multiplier", unitNote: "x subtotal" },
  { key: "FESTIVAL_MULTIPLIER", value: "2.0", category: "USER", label: "Festival multiplier", unitNote: "x subtotal" },
  { key: "RAIN_SURCHARGE", value: "20", category: "USER", label: "Rain surcharge", unitNote: "flat ₹" },
  { key: "NIGHT_CHARGE", value: "30", category: "USER", label: "Night charge", unitNote: "flat ₹" },
  { key: "WAITING_CHARGE_PER_MIN", value: "1", category: "USER", label: "Waiting charge", unitNote: "₹/min" },
  { key: "PER_KM_PRICE", value: "0", category: "USER", label: "Per-km distance price", unitNote: "₹/km" },
  { key: "BOOKING_FEE_FLAT", value: "0", category: "USER", label: "Booking fee", unitNote: "flat ₹" },
  { key: "SERVICE_FEE_FLAT", value: "0", category: "USER", label: "Service fee", unitNote: "flat ₹" },
  { key: "DISCOUNT_PERCENT", value: "0", category: "USER", label: "Global discount", unitNote: "% off subtotal" },
  { key: "TAX_PERCENT", value: "0", category: "USER", label: "Tax (GST)", unitNote: "% on total" },
  { key: "MIN_BOOKING_AMOUNT", value: "50", category: "USER", label: "Minimum booking amount", unitNote: "flat ₹" },
  { key: "CANCELLATION_FEE_USER", value: "20", category: "USER", label: "User cancellation fee", unitNote: "flat ₹" },
  // ---- PARTNER fees ----
  { key: "PARTNER_COMMISSION_PERCENT", value: "1", category: "PARTNER", label: "Partner commission", unitNote: "% deducted from earning" },
  { key: "PARTNER_SERVICE_FEE_FLAT", value: "0", category: "PARTNER", label: "Partner service fee", unitNote: "flat ₹ per job" },
  { key: "PARTNER_INCENTIVE_BONUS", value: "0", category: "PARTNER", label: "Partner incentive/bonus", unitNote: "flat ₹ per completed job" },
  { key: "MIN_WITHDRAWAL_AMOUNT", value: "100", category: "PARTNER", label: "Minimum withdrawal amount", unitNote: "flat ₹" },
  { key: "WITHDRAWAL_FEE_FLAT", value: "0", category: "PARTNER", label: "Withdrawal fee", unitNote: "flat ₹" },
  { key: "CANCELLATION_PENALTY_PARTNER", value: "50", category: "PARTNER", label: "Partner cancellation penalty", unitNote: "flat ₹" },
];

(async () => {
  for (const s of SEED) {
    await p.pricingConfig.upsert({
      where: { key: s.key },
      update: { value: s.value, category: s.category, isActive: true },
      create: {
        key: s.key,
        value: s.value,
        category: s.category,
        description: `${s.label} (${s.unitNote})`,
      },
    });
    console.log("seeded", s.key, "=", s.value);
  }
  await p.$disconnect();
})();

// Expanded Partner Ecosystem — single source of truth for all 14 services.
// Pricing here are DEFAULTS only; every value is overridable at runtime by the
// admin via the PricingConfig table (scoped key: `${SERVICE}_${KEY}`). The
// backend NEVER hardcodes a fare — it reads config, falling back to these
// catalog defaults when no admin row exists.

export interface ServicePricing {
  baseFee: number;
  perMinute: number;
  perKm: number;
  minDurationMinutes: number;
  waitingChargePerMin: number;
  waitingFreeMinutes: number;
  platformFeePercent: number;
  surgeEnabled: number; // 0 | 1
  peakStart: number; // hour 0-23
  peakEnd: number; // hour 0-23
  peakMultiplier: number;
  minBookingAmount: number;
}

export interface ServiceDef {
  key: string;
  label: string;
  shortDescription: string;
  category: string;
  icon: string; // emoji used by the web client
  requiresItem: boolean; // carry/errand style: item description needed
  requiresDistance: boolean; // distance-based fare component applies
  pricing: ServicePricing;
}

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    key: "WALKING",
    label: "Walking Buddy",
    shortDescription: "Companion walks, pet walks & casual strolls",
    category: "MOBILITY",
    icon: "🚶",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 50, perMinute: 2, perKm: 0.7, minDurationMinutes: 10, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "CARRY_BUDDY",
    label: "Carry Buddy",
    shortDescription: "Heavy lifting, shifting & item carrying",
    category: "LOGISTICS",
    icon: "📦",
    requiresItem: true,
    requiresDistance: true,
    pricing: { baseFee: 80, perMinute: 2.5, perKm: 1, minDurationMinutes: 10, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "FLAT_SHIFT",
    label: "Flat Shift",
    shortDescription: "Helping hands for flat shuffling & rearrangement",
    category: "LOGISTICS",
    icon: "🛋️",
    requiresItem: false,
    requiresDistance: false,
    pricing: { baseFee: 60, perMinute: 3, perKm: 0, minDurationMinutes: 30, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "LOCAL_MOVE",
    label: "Local Move",
    shortDescription: "Small house/room local shifting",
    category: "LOGISTICS",
    icon: "🚚",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 120, perMinute: 4, perKm: 2, minDurationMinutes: 60, waitingChargePerMin: 0, waitingFreeMinutes: 10, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "RIDE_BUDDY",
    label: "Ride Buddy",
    shortDescription: "Buddy ride for short passenger hops",
    category: "MOBILITY",
    icon: "🛵",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 40, perMinute: 3, perKm: 2.5, minDurationMinutes: 15, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "ERRAND_BUDDY",
    label: "Errand Buddy",
    shortDescription: "Pickups, drops & quick errands",
    category: "LOGISTICS",
    icon: "🏃",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 30, perMinute: 2.5, perKm: 1.5, minDurationMinutes: 15, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "WAIT_BUDDY",
    label: "Wait Buddy",
    shortDescription: "Stand in queue / wait on your behalf",
    category: "SPECIAL",
    icon: "⏳",
    requiresItem: false,
    requiresDistance: false,
    pricing: { baseFee: 0, perMinute: 2, perKm: 0, minDurationMinutes: 15, waitingChargePerMin: 2, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "STUDY_BUDDY",
    label: "Study Buddy",
    shortDescription: "Peer study & doubt-clearing sessions",
    category: "CARE",
    icon: "📚",
    requiresItem: false,
    requiresDistance: false,
    pricing: { baseFee: 50, perMinute: 4, perKm: 0, minDurationMinutes: 30, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "SPOT_BUDDY",
    label: "Spot Buddy",
    shortDescription: "Hold a spot / reservation on your behalf",
    category: "SPECIAL",
    icon: "📍",
    requiresItem: false,
    requiresDistance: false,
    pricing: { baseFee: 20, perMinute: 2, perKm: 0, minDurationMinutes: 15, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "TRAVEL_BUDDY",
    label: "Travel Buddy",
    shortDescription: "Companion for trips & transit help",
    category: "MOBILITY",
    icon: "✈️",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 60, perMinute: 3, perKm: 2, minDurationMinutes: 30, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "EVENT_BUDDY",
    label: "Event Buddy",
    shortDescription: "On-ground help for events & gatherings",
    category: "SPECIAL",
    icon: "🎉",
    requiresItem: false,
    requiresDistance: false,
    pricing: { baseFee: 80, perMinute: 3.5, perKm: 0, minDurationMinutes: 60, waitingChargePerMin: 0, waitingFreeMinutes: 10, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "BUSINESS_BUDDY",
    label: "Business Buddy",
    shortDescription: "Business errands & courier support",
    category: "BUSINESS",
    icon: "💼",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 100, perMinute: 5, perKm: 1.5, minDurationMinutes: 30, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "PET_BUDDY",
    label: "Pet Buddy",
    shortDescription: "Pet sitting, walking & care",
    category: "CARE",
    icon: "🐾",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 60, perMinute: 3, perKm: 1, minDurationMinutes: 15, waitingChargePerMin: 0, waitingFreeMinutes: 5, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
  {
    key: "COMMERCIAL",
    label: "Commercial & Industrial",
    shortDescription: "Bulk commercial & industrial support",
    category: "BUSINESS",
    icon: "🏭",
    requiresItem: false,
    requiresDistance: true,
    pricing: { baseFee: 200, perMinute: 6, perKm: 4, minDurationMinutes: 120, waitingChargePerMin: 0, waitingFreeMinutes: 10, platformFeePercent: 1, surgeEnabled: 0, peakStart: 0, peakEnd: 0, peakMultiplier: 1.25, minBookingAmount: 0 },
  },
];

export const SERVICE_KEYS: string[] = SERVICE_CATALOG.map((s) => s.key);

export function getServiceDef(key: string): ServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.key === key);
}

export function isServiceEnabled(key: string): boolean {
  return getServiceDef(key)?.pricing !== undefined;
}

// Build the per-key default map used by bookingEngine's getServiceConfig fallback.
export function catalogDefaults(key: string): Record<string, number> {
  const def = getServiceDef(key);
  if (!def) {
    return {
      BASE_FEE: 0,
      PER_MINUTE_PRICE: 2,
      PER_KM_PRICE: 0,
      MIN_DURATION_MINUTES: 0,
      WAITING_CHARGE_PER_MIN: 0,
      WAITING_FREE_MINUTES: 5,
      PLATFORM_FEE_PERCENT: 1,
      SURGE_ENABLED: 0,
      PEAK_HOUR_START: 0,
      PEAK_HOUR_END: 0,
      PEAK_MULTIPLIER: 1.25,
      MIN_BOOKING_AMOUNT: 0,
      BOOKING_FEE_FLAT: 0,
      SERVICE_FEE_FLAT: 0,
      DISCOUNT_PERCENT: 0,
      TAX_PERCENT: 0,
      NIGHT_CHARGE: 0,
      NIGHT_START_HOUR: 22,
      NIGHT_END_HOUR: 6,
      RAIN_SURCHARGE: 0,
      RAIN_ENABLED: 0,
      FESTIVAL_MULTIPLIER: 1,
      FESTIVAL_ENABLED: 0,
      PER_MINUTE_AFTER_30: 2,
    };
  }
  const p = def.pricing;
  return {
    BASE_FEE: p.baseFee,
    PER_MINUTE_PRICE: p.perMinute,
    PER_KM_PRICE: p.perKm,
    MIN_DURATION_MINUTES: p.minDurationMinutes,
    WAITING_CHARGE_PER_MIN: p.waitingChargePerMin,
    WAITING_FREE_MINUTES: p.waitingFreeMinutes,
    PLATFORM_FEE_PERCENT: p.platformFeePercent,
    SURGE_ENABLED: p.surgeEnabled,
    PEAK_HOUR_START: p.peakStart,
    PEAK_HOUR_END: p.peakEnd,
    PEAK_MULTIPLIER: p.peakMultiplier,
    MIN_BOOKING_AMOUNT: p.minBookingAmount,
    BOOKING_FEE_FLAT: 0,
    SERVICE_FEE_FLAT: 0,
    DISCOUNT_PERCENT: 0,
    TAX_PERCENT: 0,
    NIGHT_CHARGE: 0,
    NIGHT_START_HOUR: 22,
    NIGHT_END_HOUR: 6,
    RAIN_SURCHARGE: 0,
    RAIN_ENABLED: 0,
    FESTIVAL_MULTIPLIER: 1,
    FESTIVAL_ENABLED: 0,
    PER_MINUTE_AFTER_30: p.perMinute,
  };
}

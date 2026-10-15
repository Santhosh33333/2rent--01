// Nabri social services — single source of truth for the catalogue.
//
// The catalogue is now in-app companionship: talk, vent, time-pass, date and
// friends. Every one of them is delivered over an in-app call or chat, so no
// entry involves travel, an item or a drop-off — `requiresDistance`,
// `requiresItem` and `requiresDropoff` are all false. The old local-services
// (walking/carry) catalogue is retired; see LEGACY_SERVICE_LABELS for how
// bookings already in the database keep a readable name.
//
// Pricing here are DEFAULTS only; every value is overridable at runtime by the
// admin via the PricingConfig table (scoped key: `${SERVICE}_${KEY}`). The
// backend NEVER hardcodes a fare — it reads config, falling back to these
// catalog defaults when no admin row exists. The platform fee is admin-editable
// too and defaults to 1%.

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
  requiresDropoff: boolean; // pickup-to-drop services: destination mandatory
  pricing: ServicePricing;
}

// Shared shape so the six entries read as one catalogue, not six unrelated
// numbers. Platform fee is 1% for every service; the fare is time-based.
function pricing(baseFee: number, perMinute: number, minDurationMinutes: number): ServicePricing {
  return {
    baseFee,
    perMinute,
    perKm: 0,
    minDurationMinutes,
    waitingChargePerMin: 0,
    waitingFreeMinutes: 5,
    platformFeePercent: 1,
    surgeEnabled: 0,
    peakStart: 0,
    peakEnd: 0,
    peakMultiplier: 1.25,
    minBookingAmount: 0,
  };
}

export const SERVICE_CATALOG: ServiceDef[] = [
  {
    key: "TALK",
    label: "Talk",
    shortDescription: "One-to-one talk over an in-app call or chat",
    category: "SOCIAL",
    icon: "💬",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(50, 4, 15),
  },
  {
    key: "VENT",
    label: "Vent",
    shortDescription: "Let it all out to someone who listens",
    category: "SOCIAL",
    icon: "🫂",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(50, 4, 15),
  },
  {
    key: "TIME_PASS",
    label: "Time-pass",
    shortDescription: "Easy company to pass the time",
    category: "SOCIAL",
    icon: "⏳",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(30, 3, 15),
  },
  {
    key: "DATE",
    label: "Date",
    shortDescription: "A companion for a date, over call or chat",
    category: "SOCIAL",
    icon: "💞",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(100, 5, 30),
  },
  {
    key: "FRIENDS",
    label: "Friends",
    shortDescription: "Meet a new friend and hang out",
    category: "SOCIAL",
    icon: "🤝",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(50, 4, 30),
  },
  {
    key: "OTHER",
    label: "Other",
    shortDescription: "Something else — describe it in the details",
    category: "SOCIAL",
    icon: "✨",
    requiresItem: false,
    requiresDistance: false,
    requiresDropoff: false,
    pricing: pricing(0, 3, 15),
  },
];

export const SERVICE_KEYS: string[] = SERVICE_CATALOG.map((s) => s.key);

/**
 * Names for the retired local-services catalogue.
 *
 * These keys are no longer offered anywhere, but bookings already in the
 * database still carry them, so a historical booking keeps a human name instead
 * of showing a bare key. Deliberately display-only — nothing here is bookable.
 */
export const LEGACY_SERVICE_LABELS: Record<string, string> = {
  WALKING: "Walking Buddy",
  CARRY_BUDDY: "Carry Buddy",
  FLAT_SHIFT: "Flat Shift",
  LOCAL_MOVE: "Local Move",
  RIDE_BUDDY: "Ride Buddy",
  ERRAND_BUDDY: "Errand Buddy",
  WAIT_BUDDY: "Wait Buddy",
  STUDY_BUDDY: "Study Buddy",
  SPOT_BUDDY: "Spot Buddy",
  TRAVEL_BUDDY: "Travel Buddy",
  EVENT_BUDDY: "Event Buddy",
  BUSINESS_BUDDY: "Business Buddy",
  PET_BUDDY: "Pet Buddy",
  COMMERCIAL: "Commercial & Industrial",
};

export function getServiceDef(key: string): ServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.key === key);
}

/** Human name for any service key, current or retired. */
export function serviceLabel(key: string): string {
  return getServiceDef(key)?.label ?? LEGACY_SERVICE_LABELS[key] ?? key;
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

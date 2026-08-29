import crypto from "crypto";
import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";
import { assertTransition } from "./bookingStateMachine";
import { catalogDefaults } from "./serviceCatalog";
import { notifyBookingStatusChange } from "../controllers/notificationController";

// All real rates come from the admin-controlled PricingConfig table, scoped per
// service. catalogDefaults() supplies the per-service fallback when no admin row
// exists — the backend NEVER hardcodes a fare.
const DEFAULT_PLATFORM_FEE_PERCENT = 1;
const DEFAULT_PER_MINUTE_PRICE = 2;
export const PRICING_VERSION_KEY = "PRICING_VERSION";

// Per-service config lookup: prefers a service-scoped key (e.g. "WALKING_BASE_FEE")
// and falls back to a general key (e.g. "BASE_FEE"), then the supplied default.
export async function getServiceConfig(
  serviceType: string,
  key: string,
  defaultValue: number
): Promise<number> {
  const scoped = await getConfig(`${serviceType}_${key}`, undefined as unknown as number);
  if (scoped !== undefined && Number.isFinite(scoped)) return scoped;
  const general = await getConfig(key, defaultValue);
  if (!Number.isFinite(general)) return defaultValue;
  return general;
}

// Platform fee is admin-configurable at runtime via the PricingConfig table
// (key: PLATFORM_FEE_PERCENT, stored as a percentage, e.g. 1 => 1%).
export async function getPlatformFeePercent(serviceType: string = "WALKING"): Promise<number> {
  const pct = await getServiceConfig(serviceType, "PLATFORM_FEE_PERCENT", DEFAULT_PLATFORM_FEE_PERCENT);
  if (!Number.isFinite(pct) || pct < 0) return DEFAULT_PLATFORM_FEE_PERCENT;
  return pct;
}

function haversineKm(
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null
): number {
  if (
    lat1 == null || lon1 == null || lat2 == null || lon2 == null ||
    ![lat1, lon1, lat2, lon2].every((v) => Number.isFinite(v))
  ) return 0;
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// All monetary values are admin-configurable via PricingConfig (see
// scripts/seed-pricing.js). Server-side only: the frontend never computes fares.
// Pricing is PER-MINUTE from minute 1 (no hardcoded 30-minute base threshold),
// and each service (WALKING / CARRY_BUDDY) can have its own admin-set rates.
// SURGE / PEAK: admin-configurable, fully transparent. Returns 1 when no
// surge applies, otherwise a multiplier >1. Surge ONLY applies when the admin
// has explicitly enabled it (SURGE_ENABLED=1) AND the booking falls inside a
// configured peak hour window (PEAK_HOUR_START..PEAK_HOUR_END). The multiplier
// is always surfaced to the user (never applied silently) and frozen into the
// pricing snapshot.
async function getSurgeMultiplier(
  serviceType: string,
  when: Date = new Date()
): Promise<number> {
  const defaults = catalogDefaults(serviceType);
  const [surgeActive, peakHourFrom, peakHourTo, peakMultiplier] = await Promise.all([
    getServiceConfig(serviceType, "SURGE_ENABLED", defaults.SURGE_ENABLED),
    getServiceConfig(serviceType, "PEAK_HOUR_START", defaults.PEAK_HOUR_START),
    getServiceConfig(serviceType, "PEAK_HOUR_END", defaults.PEAK_HOUR_END),
    getServiceConfig(serviceType, "PEAK_MULTIPLIER", defaults.PEAK_MULTIPLIER),
  ]);

  // Surge only when explicitly enabled and a real peak window is configured.
  if (surgeActive <= 0) return 1;
  if (peakHourFrom === peakHourTo) return 1;

  const hour = when.getHours();
  if (peakHourFrom < peakHourTo) {
    // Same-day window (e.g. 17..21)
    if (hour >= peakHourFrom && hour < peakHourTo) return Math.max(1, peakMultiplier);
    return 1;
  }
  // Overnight window (e.g. 21..06): wraps past midnight.
  if (hour >= peakHourFrom || hour < peakHourTo) return Math.max(1, peakMultiplier);
  return 1;
}

const round2 = (n: number): number => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return Math.round(v * 100) / 100;
};

// Night window check. Supports windows that wrap past midnight (e.g. 22..06).
function isNightHour(hour: number, start: number, end: number): boolean {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  if (start < end) return hour >= start && hour < end;
  return hour >= start || hour < end;
}

export interface SurchargeOverride {
  surgeMultiplier?: number;
  festivalMultiplier?: number;
  nightApplied?: number;
  rainApplied?: number;
}

/**
 * Single source of truth for fare computation. Used by the estimate (createBooking /
 * getPriceEstimate), the admin simulator, and the final settlement (finalizeBookingPrice).
 * Every component is admin-configurable via PricingConfig and falls back to catalogDefaults.
 * Surcharges: tiered per-minute (PER_MINUTE_AFTER_30), night flat (NIGHT_CHARGE within a
 * configurable window), rain flat (RAIN_SURCHARGE, only when RAIN_ENABLED), and festival
 * multiplier (FESTIVAL_MULTIPLIER, only when FESTIVAL_ENABLED). Surge already existed.
 */
export async function computeFare(
  serviceType: string,
  durationMinutes: number,
  distanceKm = 0,
  when?: Date,
  draft?: Record<string, number>,
  surchargeOverride?: SurchargeOverride,
  extraFlat = 0
) {
  const DEFAULTS = catalogDefaults(serviceType);
  const read = async (key: string, def: number): Promise<number> => {
    if (draft && draft[key] !== undefined && Number.isFinite(draft[key])) return draft[key];
    return getServiceConfig(serviceType, key, DEFAULTS[key]);
  };

  const baseFee = await read("BASE_FEE", DEFAULTS.BASE_FEE);
  const perMinutePrice = await read("PER_MINUTE_PRICE", DEFAULTS.PER_MINUTE_PRICE);
  const perKmPrice = await read("PER_KM_PRICE", DEFAULTS.PER_KM_PRICE);
  const bookingFee = await read("BOOKING_FEE_FLAT", DEFAULTS.BOOKING_FEE_FLAT);
  const serviceFee = await read("SERVICE_FEE_FLAT", DEFAULTS.SERVICE_FEE_FLAT);
  const discountPercent = await read("DISCOUNT_PERCENT", DEFAULTS.DISCOUNT_PERCENT);
  const taxPercent = await read("TAX_PERCENT", DEFAULTS.TAX_PERCENT);
  const platformFeePercent = await read("PLATFORM_FEE_PERCENT", DEFAULTS.PLATFORM_FEE_PERCENT);
  const minBooking = await read("MIN_BOOKING_AMOUNT", DEFAULTS.MIN_BOOKING_AMOUNT);
  const perMinuteAfter30 = await read("PER_MINUTE_AFTER_30", DEFAULTS.PER_MINUTE_AFTER_30);
  const nightCharge = await read("NIGHT_CHARGE", DEFAULTS.NIGHT_CHARGE);
  const nightStartHour = await read("NIGHT_START_HOUR", DEFAULTS.NIGHT_START_HOUR);
  const nightEndHour = await read("NIGHT_END_HOUR", DEFAULTS.NIGHT_END_HOUR);
  const rainCharge = await read("RAIN_SURCHARGE", DEFAULTS.RAIN_SURCHARGE);
  const rainEnabled = await read("RAIN_ENABLED", DEFAULTS.RAIN_ENABLED);
  const festivalMultiplier = await read("FESTIVAL_MULTIPLIER", DEFAULTS.FESTIVAL_MULTIPLIER);
  const festivalEnabled = await read("FESTIVAL_ENABLED", DEFAULTS.FESTIVAL_ENABLED);

  const whenDate = when || new Date();
  const surge = surchargeOverride?.surgeMultiplier ?? (await getSurgeMultiplier(serviceType, whenDate));
  const festivalMul =
    surchargeOverride?.festivalMultiplier ?? (festivalEnabled > 0 ? Math.max(1, festivalMultiplier) : 1);

  // Tiered per-minute: first 30 min at PER_MINUTE_PRICE, remainder at PER_MINUTE_AFTER_30.
  const dur = Math.max(0, durationMinutes);
  const tierThreshold = 30;
  let timeCharge: number;
  if (perMinuteAfter30 > 0 && dur > tierThreshold) {
    timeCharge = tierThreshold * perMinutePrice + (dur - tierThreshold) * perMinuteAfter30;
  } else {
    timeCharge = dur * perMinutePrice;
  }
  // Surge + festival multiply the time/distance portion (transparent, itemised).
  timeCharge = round2(timeCharge * surge * festivalMul);
  const distanceCharge = round2(Math.max(0, distanceKm) * perKmPrice * surge * festivalMul);

  const hour = whenDate.getHours();
  const nightApplied =
    surchargeOverride?.nightApplied ?? (nightCharge > 0 && isNightHour(hour, nightStartHour, nightEndHour) ? nightCharge : 0);
  const rainApplied = surchargeOverride?.rainApplied ?? (rainEnabled > 0 && rainCharge > 0 ? rainCharge : 0);

  const subtotal = baseFee + timeCharge + distanceCharge + bookingFee + serviceFee + nightApplied + rainApplied + round2(extraFlat);
  const discount = round2(subtotal * (discountPercent / 100));
  const afterDiscount = subtotal - discount;
  const platformFee = round2(afterDiscount * (platformFeePercent / 100));
  const tax = round2(afterDiscount * (taxPercent / 100));
  const rawTotal = afterDiscount + platformFee + tax;
  const total = Math.max(minBooking, round2(rawTotal));
  const partnerEarning = round2(total - platformFee);

  return {
    estimatedAmount: total,
    platformFee,
    partnerEarning,
    baseFee,
    timeCharge,
    distanceCharge,
    bookingFee,
    serviceFee,
    discount,
    tax,
    nightCharge: nightApplied,
    rainCharge: rainApplied,
    festivalMultiplier: festivalMul,
    minApplied: total === minBooking && rawTotal < minBooking,
    platformFeePercent,
    surgeApplied: surge > 1,
    surgeMultiplier: surge,
    config: {
      baseFee,
      perMinutePrice,
      perKmPrice,
      bookingFee,
      serviceFee,
      discountPercent,
      taxPercent,
      platformFeePercent,
      minBooking,
      perMinuteAfter30,
      nightCharge,
      nightStartHour,
      nightEndHour,
      rainCharge,
      rainEnabled,
      festivalMultiplier,
      festivalEnabled,
    },
    // Freeze the exact inputs + surcharge decision so a booking can never change price later.
    snapshot: {
      version: 0,
      serviceType,
      baseFee,
      bookingFee,
      serviceFee,
      perMinutePrice,
      perKmPrice,
      platformFeePercent,
      discountPercent,
      taxPercent,
      minBooking,
      perMinuteAfter30,
      nightCharge,
      nightStartHour,
      nightEndHour,
      rainCharge,
      rainEnabled,
      festivalMultiplier,
      festivalEnabled,
      surgeMultiplier: surge,
      nightApplied,
      rainApplied,
      computedAt: new Date().toISOString(),
    },
  };
}

async function calculatePrice(
  serviceType: string,
  durationMinutes: number = 30,
  distanceKm = 0,
  when: Date = new Date()
) {
  return computeFare(serviceType, durationMinutes, distanceKm, when);
}

// Validates the requested duration against the admin-configured minimum.
export async function validateMinDuration(
  serviceType: string,
  durationMinutes: number
): Promise<{ ok: boolean; minDuration: number; message?: string }> {
  const minDuration = await getServiceConfig(serviceType, "MIN_DURATION_MINUTES", catalogDefaults(serviceType).MIN_DURATION_MINUTES);
  if (minDuration > 0 && durationMinutes < minDuration) {
    return { ok: false, minDuration, message: `Minimum booking for this service is ${minDuration} minutes.` };
  }
  return { ok: true, minDuration };
}

// Settles the FINAL price on completion using the VERIFIED actual duration
// (timer on the server: startedAt -> completedAt), the frozen pricing snapshot
// rates, plus any admin-configured waiting fee. Recalculates platform fee,
// partner earnings, and adjusts the prepaid wallet debit accordingly.
//
// Rules:
//  - Uses snapshot rates (never live config) so confirmed bookings are stable.
//  - The user is never charged more than the quoted estimate (no silent upsell);
//    if the actual run is shorter, the difference is refunded automatically.
export async function finalizeBookingPrice(
  bookingId: string,
  actualMinutes: number,
  waitingMinutes = 0,
  tx: any = prisma
): Promise<{ finalAmount: number; platformFee: number; partnerEarning: number; refunded: number; extraDebited: number }> {
  const booking = await tx.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found");

  const snapshot: any = booking.pricingSnapshot || {};
  const serviceType = booking.serviceType as string;

  // Waiting fee (admin-configured): free window then per-minute charge.
  const [waitingChargePerMin, waitingFreeMinutes] = await Promise.all([
    getServiceConfig(serviceType, "WAITING_CHARGE_PER_MIN", 0),
    getServiceConfig(serviceType, "WAITING_FREE_MINUTES", 5),
  ]);
  const billableWaiting = Math.max(0, waitingMinutes - waitingFreeMinutes);
  const waitingCharge = Math.round(billableWaiting * waitingChargePerMin * 100) / 100;

  // Recompute the fare with the SAME engine used at estimate time, frozen to the
  // booking's pricing snapshot so surcharges (night/rain/festival/surge/tier) are
  // replayed exactly as quoted — the user is never charged more than the estimate.
  const draft: Record<string, number> = {
    BASE_FEE: Number.isFinite(snapshot.baseFee) ? snapshot.baseFee : 0,
    PER_MINUTE_PRICE: Number.isFinite(snapshot.perMinutePrice) ? snapshot.perMinutePrice : DEFAULT_PER_MINUTE_PRICE,
    PER_KM_PRICE: Number.isFinite(snapshot.perKmPrice) ? snapshot.perKmPrice : 0,
    BOOKING_FEE_FLAT: Number.isFinite(snapshot.bookingFee) ? snapshot.bookingFee : 0,
    SERVICE_FEE_FLAT: Number.isFinite(snapshot.serviceFee) ? snapshot.serviceFee : 0,
    DISCOUNT_PERCENT: Number.isFinite(snapshot.discountPercent) ? snapshot.discountPercent : 0,
    TAX_PERCENT: Number.isFinite(snapshot.taxPercent) ? snapshot.taxPercent : 0,
    PLATFORM_FEE_PERCENT: Number.isFinite(snapshot.platformFeePercent) ? snapshot.platformFeePercent : DEFAULT_PLATFORM_FEE_PERCENT,
    MIN_BOOKING_AMOUNT: Number.isFinite(snapshot.minBooking) ? snapshot.minBooking : 0,
    PER_MINUTE_AFTER_30: Number.isFinite(snapshot.perMinuteAfter30) ? snapshot.perMinuteAfter30 : 0,
    NIGHT_CHARGE: Number.isFinite(snapshot.nightCharge) ? snapshot.nightCharge : 0,
    NIGHT_START_HOUR: Number.isFinite(snapshot.nightStartHour) ? snapshot.nightStartHour : 22,
    NIGHT_END_HOUR: Number.isFinite(snapshot.nightEndHour) ? snapshot.nightEndHour : 6,
    RAIN_SURCHARGE: Number.isFinite(snapshot.rainCharge) ? snapshot.rainCharge : 0,
    RAIN_ENABLED: Number.isFinite(snapshot.rainEnabled) ? snapshot.rainEnabled : 0,
    FESTIVAL_MULTIPLIER: Number.isFinite(snapshot.festivalMultiplier) ? snapshot.festivalMultiplier : 1,
    FESTIVAL_ENABLED: Number.isFinite(snapshot.festivalEnabled) ? snapshot.festivalEnabled : 0,
  };
  const surchargeOverride = {
    surgeMultiplier: Number.isFinite(snapshot.surgeMultiplier) ? snapshot.surgeMultiplier : 1,
    festivalMultiplier: Number.isFinite(snapshot.festivalMultiplier) ? snapshot.festivalMultiplier : 1,
    nightApplied: Number.isFinite(snapshot.nightApplied) ? snapshot.nightApplied : 0,
    rainApplied: Number.isFinite(snapshot.rainApplied) ? snapshot.rainApplied : 0,
  };

  const distanceKm = booking.endLatitude && booking.startLatitude
    ? haversineKm(booking.startLatitude, booking.startLongitude, booking.endLatitude, booking.endLongitude)
    : 0;
  const fare = await computeFare(
    serviceType,
    Math.max(1, Math.round(actualMinutes)),
    distanceKm,
    (booking.startedAt as Date) || new Date(),
    draft,
    surchargeOverride,
    waitingCharge
  );
  const platformFee = fare.platformFee;
  const computedFinal = fare.estimatedAmount;

  const deposited = Number.isFinite(booking.estimatedAmount) ? Number(booking.estimatedAmount) : 0;
  const finalAmount = Math.min(computedFinal, deposited || computedFinal);

  let refunded = 0;
  let extraDebited = 0;
  if (deposited > 0) {
    if (finalAmount < deposited) {
      refunded = Math.round((deposited - finalAmount) * 100) / 100;
      const wallet = await tx.wallet.upsert({ where: { userId: booking.userId }, update: {}, create: { userId: booking.userId } });
      await tx.wallet.update({ where: { userId: booking.userId }, data: { balance: { increment: refunded } } });
      await tx.transaction.create({
        data: {
          userId: booking.userId,
          walletId: wallet.id,
          bookingId: booking.id,
          type: "REFUND",
          amount: refunded,
          status: "SUCCESS",
          description: "Booking final-price refund (actual duration)",
        },
      });
    } else if (finalAmount > deposited) {
      extraDebited = Math.round((finalAmount - deposited) * 100) / 100;
    }
  }

  const partnerEarning = Math.round((finalAmount - platformFee) * 100) / 100;

  await tx.booking.update({
    where: { id: booking.id },
    data: {
      finalAmount,
      platformFee,
      partnerEarning,
    },
  });

  return { finalAmount, platformFee, partnerEarning, refunded, extraDebited };
}

export async function createBooking(
  userId: string,
  data: {
    serviceType: string;
    startLocation: string;
    endLocation: string;
    scheduledAt: string;
    durationMinutes?: number;
    itemType?: string;
    itemDescription?: string;
    notes?: string;
    startLatitude?: number;
    startLongitude?: number;
    endLatitude?: number;
    endLongitude?: number;
    distanceKm?: number;
    couponCode?: string;
  }
) {
  const duration = data.durationMinutes && data.durationMinutes > 0 ? Math.floor(data.durationMinutes) : 30;
  let distanceKm = data.distanceKm && data.distanceKm > 0 ? Number(data.distanceKm) : 0;
  if (!distanceKm) {
    distanceKm = haversineKm(data.startLatitude, data.startLongitude, data.endLatitude, data.endLongitude);
  }

  const minCheck = await validateMinDuration(data.serviceType, duration);
  if (!minCheck.ok) {
    const err: any = new Error(minCheck.message || "Booking below minimum duration.");
    err.code = "MIN_DURATION";
    throw err;
  }

  const scheduled = new Date(data.scheduledAt);
  const pricing = await calculatePrice(data.serviceType, duration, distanceKm, scheduled);
  const pricingVersion = await getConfig(PRICING_VERSION_KEY, 1);
  pricing.snapshot.version = Number.isFinite(pricingVersion) ? Math.floor(pricingVersion) : 1;

  // Cash bookings are paid peer-to-peer: the user is NOT debited up front and the
  // platform does not hold escrow. Online/wallet bookings are debited immediately
  // (escrow) and settled/refunded on completion or expiry.
  let isCash = false;
  try {
    const n = data.notes ? JSON.parse(data.notes) : {};
    isCash = n.paymentMethod === "CASH";
  } catch {
    // ignore malformed notes
  }

  const result = await prisma.$transaction(async (tx) => {
    let wallet = await tx.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await tx.wallet.create({ data: { userId } });
    }

    if (!isCash) {
      if (Number(wallet.balance) < pricing.estimatedAmount) {
        const err: any = new Error(
          `Insufficient wallet balance. You need ₹${pricing.estimatedAmount} — please top up first.`
        );
        err.code = "INSUFFICIENT_BALANCE";
        throw err;
      }

      await tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: pricing.estimatedAmount } },
      });
    }

    const booking = await tx.booking.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        serviceType: data.serviceType,
        status: "PARTNER_SEARCHING",
        paymentStatus: isCash ? "PENDING_CASH" : "PAID",
        paymentVerifiedAt: isCash ? null : new Date(),
        finalAmount: pricing.estimatedAmount,
        startLocation: data.startLocation,
        endLocation: data.endLocation,
        startLatitude: data.startLatitude,
        startLongitude: data.startLongitude,
        endLatitude: data.endLatitude,
        endLongitude: data.endLongitude,
        scheduledAt: new Date(data.scheduledAt),
        durationMinutes: duration,
        itemType: data.itemType,
        itemDescription: data.itemDescription,
        notes: data.notes,
        estimatedAmount: pricing.estimatedAmount,
        platformFee: pricing.platformFee,
        partnerEarning: pricing.partnerEarning,
        couponCode: data.couponCode,
        discountAmount: pricing.discount > 0 ? pricing.discount : undefined,
        pricingVersion: pricing.snapshot.version,
        pricingSnapshot: pricing.snapshot,
      },
    });

    if (!isCash) {
      await tx.transaction.create({
        data: {
          userId,
          walletId: wallet.id,
          bookingId: booking.id,
          type: "WALLET_DEBIT",
          amount: pricing.estimatedAmount,
          status: "SUCCESS",
          description: `Booking payment - ${data.serviceType}`,
        },
      });
    }

    return { booking, balance: wallet.balance };
  });

  return result.booking;
}

export async function getPriceEstimate(data: {
  serviceType: string;
  startLatitude?: number;
  startLongitude?: number;
  endLatitude?: number;
  endLongitude?: number;
  durationMinutes?: number;
  distanceKm?: number;
}) {
  const duration = data.durationMinutes && data.durationMinutes > 0 ? Math.floor(data.durationMinutes) : 30;
  let distanceKm = data.distanceKm && data.distanceKm > 0 ? Number(data.distanceKm) : 0;
  if (!distanceKm) {
    distanceKm = haversineKm(data.startLatitude, data.startLongitude, data.endLatitude, data.endLongitude);
  }
  const pricing = await calculatePrice(data.serviceType, duration, distanceKm);
  return { ...pricing, basePrice: pricing.baseFee, distanceKm };
}

// Admin "Test Price" simulator: preview the fare using a literal distance and,
// optionally, DRAFT values that are not yet saved (so pricing can be tested
// before the admin activates the change).
export async function simulatePrice(options: {
  serviceType: string;
  durationMinutes: number;
  distanceKm?: number;
  draft?: Record<string, number>;
}) {
  const duration = options.durationMinutes && options.durationMinutes > 0 ? Math.floor(options.durationMinutes) : 30;
  const distanceKm = options.distanceKm && options.distanceKm > 0 ? Number(options.distanceKm) : 0;
  const stype = options.serviceType;
  const r = await computeFare(stype, duration, distanceKm, new Date(), options.draft || {});

  return {
    serviceType: stype,
    durationMinutes: duration,
    distanceKm,
    pricing: r.config,
    breakdown: {
      baseFee: r.baseFee,
      timeCharge: r.timeCharge,
      distanceCharge: r.distanceCharge,
      bookingFee: r.bookingFee,
      serviceFee: r.serviceFee,
      discount: r.discount,
      platformFee: r.platformFee,
      tax: r.tax,
      nightCharge: r.nightCharge,
      rainCharge: r.rainCharge,
    },
    totals: {
      userPays: r.estimatedAmount,
      platformFee: r.platformFee,
      partnerEarnings: r.partnerEarning,
    },
  };
}

export async function updateBookingStatus(bookingId: string, status: string, extra?: Record<string, any>) {
  const current = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true },
  });
  if (!current) throw new Error("Booking not found");
  // Central state-machine guard: illegal transitions are rejected server-side.
  assertTransition(current.status, status);
  const booking = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status,
      ...(extra || {}),
    },
  });
  return booking;
}

export async function getBookingById(bookingId: string) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      user: {
        select: { id: true, fullName: true, avatarUrl: true },
      },
      partner: {
        include: {
          user: {
            select: { id: true, fullName: true, avatarUrl: true },
          },
        },
      },
    },
  });
  return booking;
}

export async function cancelBooking(bookingId: string, cancelledBy: "USER" | "PARTNER", reason?: string) {
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (!booking) throw new Error("Booking not found");

  // Idempotency: already-terminal bookings must never re-cancel or re-refund
  const terminalStatuses = ["CANCELLED", "REFUND_INITIATED", "REFUND_COMPLETED"];
  if (terminalStatuses.includes(booking.status)) {
    return { booking, refundProcessed: false };
  }

  // Atomic claim so exactly ONE concurrent caller performs cancellation+refund
  const claimed = await prisma.booking.updateMany({
    where: { id: bookingId, status: { notIn: terminalStatuses } },
    data: {
      status: "CANCELLED",
      cancelledBy,
      cancelReason: reason,
      cancelledAt: new Date(),
    },
  });

  let refundProcessed = false;
  const refundableStatuses = ["PAYMENT_PENDING", "PAYMENT_INITIATED", "PAYMENT_SUCCESSFUL", "PARTNER_SEARCHING", "OTP_GENERATED", "EXPIRED"];
  const partialRefundStatuses = ["PARTNER_ACCEPTED"];

  if (claimed.count !== 1) {
    // Lost the race — another request already cancelled this booking
    const fresh = await prisma.booking.findUnique({ where: { id: bookingId } });
    return { booking: fresh ?? booking, refundProcessed: false };
  }

  void notifyBookingStatusChange(bookingId, booking.userId, "CANCELLED");

  if (refundableStatuses.includes(booking.status)) {
    const refundAmount = booking.estimatedAmount ?? 0;
    if (refundAmount > 0) {
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId: booking.userId },
          create: { userId: booking.userId, balance: refundAmount },
          update: { balance: { increment: refundAmount } },
        });
        await tx.transaction.create({
          data: {
            userId: booking.userId,
            walletId: wallet.id,
            bookingId,
            type: "REFUND",
            amount: refundAmount,
            status: "SUCCESS",
            description: `Cancellation refund - ${cancelledBy}`,
          },
        });
        await tx.refundLog.create({
          data: {
            bookingId,
            userId: booking.userId,
            amount: refundAmount,
            reason: reason || "Cancelled by " + cancelledBy,
            type: "FULL",
            status: "COMPLETED",
            initiatedBy: cancelledBy,
            completedAt: new Date(),
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            refundStatus: "REFUND_COMPLETED",
            refundAmount,
            refundInitiatedAt: new Date(),
            refundCompletedAt: new Date(),
          },
        });
      });
      refundProcessed = true;
    }
  } else if (partialRefundStatuses.includes(booking.status) && !booking.otpGeneratedAt) {
    // Admin-configurable cancellation fee is deducted from the refund (Part 14).
    const cancelFee = await getConfig("CANCELLATION_FEE_USER", 0);
    const gross = booking.finalAmount ?? booking.estimatedAmount ?? 0;
    const refundAmount = Math.max(0, Math.round((gross - cancelFee) * 100) / 100);
    if (refundAmount > 0) {
      await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.upsert({
          where: { userId: booking.userId },
          create: { userId: booking.userId, balance: refundAmount },
          update: { balance: { increment: refundAmount } },
        });
        await tx.transaction.create({
          data: {
            userId: booking.userId,
            walletId: wallet.id,
            bookingId,
            type: "REFUND",
            amount: refundAmount,
            status: "SUCCESS",
            description: `Partial cancellation refund - ${cancelledBy}`,
          },
        });
        await tx.refundLog.create({
          data: {
            bookingId,
            userId: booking.userId,
            amount: refundAmount,
            reason: reason || "Cancelled by " + cancelledBy,
            type: "PARTIAL",
            status: "COMPLETED",
            initiatedBy: cancelledBy,
            completedAt: new Date(),
          },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: {
            refundStatus: "REFUND_COMPLETED",
            refundAmount,
            refundInitiatedAt: new Date(),
            refundCompletedAt: new Date(),
          },
        });
      });
      refundProcessed = true;
    }
  }

  const updatedBooking = await prisma.booking.findUnique({
    where: { id: bookingId },
  });

  return { booking: updatedBooking ?? booking, refundProcessed };
}

export async function processTimeoutBookings() {
  const timeouts = await prisma.bookingTimeout.findMany({
    where: {
      isProcessed: false,
      timeoutAt: { lte: new Date() },
    },
    include: { booking: true },
  });

  for (const timeout of timeouts) {
    try {
      await cancelBooking(timeout.bookingId, "USER", "Booking timeout");
      await prisma.bookingTimeout.update({
        where: { id: timeout.id },
        data: { isProcessed: true },
      });
    } catch (err: any) {
      console.error(`[TIMEOUT] Failed to process timeout ${timeout.id} for booking ${timeout.bookingId}:`, err.message || err);
      continue;
    }
  }

  return timeouts.length;
}

import { prisma } from "../config/database";

// Default pricing constants
const DEFAULT_BASE_FEE = 50; // ₹50 for first 30 minutes
const DEFAULT_PER_MINUTE_AFTER_30 = 2; // ₹2 per additional minute
const DEFAULT_PLATFORM_FEE_PERCENT = 10; // 10% platform fee (matches booking engine default)
const DEFAULT_PEAK_HOUR_MULTIPLIER = 1.5;
const DEFAULT_FESTIVAL_MULTIPLIER = 2.0;
const DEFAULT_RAIN_SURCHARGE = 20; // ₹20 flat
const DEFAULT_NIGHT_CHARGE = 30; // ₹30 flat
const DEFAULT_WAITING_CHARGE_PER_MIN = 1; // ₹1 per minute waiting

export interface PriceCalculationOptions {
  durationMinutes: number;
  isPeakHour?: boolean;
  isFestival?: boolean;
  isRaining?: boolean;
  isNight?: boolean;
  waitingMinutes?: number;
  couponCode?: string;
  distanceKm?: number;
  serviceAreaMultiplier?: number;
}

export interface PriceBreakdown {
  baseFare: number;
  timeCharge: number;
  waitingCharge: number;
  peakCharge: number;
  festivalCharge: number;
  rainSurcharge: number;
  nightCharge: number;
  distanceCharge: number;
  subtotal: number;
  platformFee: number;
  platformFeePercent: number;
  discount: number;
  couponDiscount: number;
  couponCode?: string;
  finalAmount: number;
  partnerEarning: number;
  commissionDeduction: number;
}

export interface PartnerEarningSummary {
  todayEarnings: number;
  weeklyEarnings: number;
  monthlyEarnings: number;
  lifetimeEarnings: number;
  pendingEarnings: number;
  withdrawableBalance: number;
  completedJobs: number;
  cancelledJobs: number;
  averageRating: number;
  incentives: number;
  bonuses: number;
  commissionDeduction: number;
  level: string;
  levelPoints: number;
}

export async function getConfig(key: string, defaultValue: number): Promise<number> {
  try {
    const config = await prisma.pricingConfig.findUnique({ where: { key } });
    if (config && config.isActive) {
      return parseFloat(config.value);
    }
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function calculatePrice(options: PriceCalculationOptions): Promise<PriceBreakdown> {
  const {
    durationMinutes,
    isPeakHour = false,
    isFestival = false,
    isRaining = false,
    isNight = false,
    waitingMinutes = 0,
    couponCode,
    distanceKm = 0,
    serviceAreaMultiplier = 1.0,
  } = options;

  // Fetch all configurable pricing parameters
  const [
    baseFee,
    perMinuteAfter30,
    platformFeePercent,
    peakHourMultiplier,
    festivalMultiplier,
    rainSurcharge,
    nightCharge,
    waitingChargePerMin,
  ] = await Promise.all([
    getConfig("BASE_FEE", DEFAULT_BASE_FEE),
    getConfig("PER_MINUTE_AFTER_30", DEFAULT_PER_MINUTE_AFTER_30),
    getConfig("PLATFORM_FEE_PERCENT", DEFAULT_PLATFORM_FEE_PERCENT),
    getConfig("PEAK_HOUR_MULTIPLIER", DEFAULT_PEAK_HOUR_MULTIPLIER),
    getConfig("FESTIVAL_MULTIPLIER", DEFAULT_FESTIVAL_MULTIPLIER),
    getConfig("RAIN_SURCHARGE", DEFAULT_RAIN_SURCHARGE),
    getConfig("NIGHT_CHARGE", DEFAULT_NIGHT_CHARGE),
    getConfig("WAITING_CHARGE_PER_MIN", DEFAULT_WAITING_CHARGE_PER_MIN),
  ]);

  // Base fare: first 30 minutes = ₹50
  const baseFare = baseFee * serviceAreaMultiplier;

  // Time charge: ₹2 per minute after 30 minutes
  let timeCharge = 0;
  if (durationMinutes > 30) {
    timeCharge = (durationMinutes - 30) * perMinuteAfter30;
  }

  // Waiting charge
  const waitingCharge = waitingMinutes * waitingChargePerMin;

  // Peak hour surcharge
  const peakCharge = isPeakHour ? (baseFare + timeCharge) * (peakHourMultiplier - 1) : 0;

  // Festival surcharge
  const festivalCharge = isFestival ? (baseFare + timeCharge) * (festivalMultiplier - 1) : 0;

  // Rain surcharge
  const rainSurchargeAmount = isRaining ? rainSurcharge : 0;

  // Night charge
  const nightChargeAmount = isNight ? nightCharge : 0;

  // Distance charge (if applicable)
  const distanceCharge = distanceKm * 2; // ₹2 per km

  // Subtotal before fees and discounts
  const subtotal = baseFare + timeCharge + waitingCharge + peakCharge + festivalCharge + rainSurchargeAmount + nightChargeAmount + distanceCharge;

  // Platform fee (1% of subtotal)
  const platformFee = Math.round((subtotal * platformFeePercent) / 100 * 100) / 100;

  // Coupon discount
  let couponDiscount = 0;
  let appliedCouponCode: string | undefined;
  if (couponCode) {
    try {
      const coupon = await prisma.coupon.findUnique({ where: { code: couponCode } });
      if (
        coupon &&
        coupon.isActive &&
        coupon.validFrom <= new Date() &&
        coupon.validTo >= new Date() &&
        subtotal >= coupon.minAmount &&
        (coupon.usageLimit === null || coupon.usedCount < coupon.usageLimit)
      ) {
        if (coupon.discountType === "PERCENTAGE") {
          couponDiscount = Math.round((subtotal * coupon.discountValue) / 100 * 100) / 100;
          if (coupon.maxDiscount && couponDiscount > coupon.maxDiscount) {
            couponDiscount = coupon.maxDiscount;
          }
        } else {
          couponDiscount = coupon.discountValue;
        }
        appliedCouponCode = couponCode;
      }
    } catch {
      // Coupon not found or error
    }
  }

  // Final amount
  const finalAmount = Math.round((subtotal + platformFee - couponDiscount) * 100) / 100;

  // Partner earning (final amount minus platform fee)
  const partnerEarning = Math.round((finalAmount - platformFee) * 100) / 100;

  // Commission deduction (platform fee)
  const commissionDeduction = platformFee;

  return {
    baseFare,
    timeCharge,
    waitingCharge,
    peakCharge,
    festivalCharge,
    rainSurcharge: rainSurchargeAmount,
    nightCharge: nightChargeAmount,
    distanceCharge,
    subtotal,
    platformFee,
    platformFeePercent,
    discount: 0,
    couponDiscount,
    couponCode: appliedCouponCode,
    finalAmount,
    partnerEarning,
    commissionDeduction,
  };
}

export async function getPartnerEarnings(userId: string): Promise<PartnerEarningSummary> {
  try {
    let earnings = await prisma.partnerEarnings.findUnique({
      where: { userId },
      include: { partnerLevel: true },
    });

    if (!earnings) {
      // Create earnings record if not exists
      const level = await prisma.partnerLevel.findUnique({ where: { userId } });
      earnings = await prisma.partnerEarnings.create({
        data: { userId },
        include: { partnerLevel: true },
      });
    }

    return {
      todayEarnings: Number(earnings.todayEarnings),
      weeklyEarnings: Number(earnings.weeklyEarnings),
      monthlyEarnings: Number(earnings.monthlyEarnings),
      lifetimeEarnings: Number(earnings.lifetimeEarnings),
      pendingEarnings: Number(earnings.pendingEarnings),
      withdrawableBalance: Number(earnings.withdrawableBalance),
      completedJobs: earnings.completedJobs,
      cancelledJobs: earnings.cancelledJobs,
      averageRating: Number(earnings.averageRating),
      incentives: Number(earnings.incentives),
      bonuses: Number(earnings.bonuses),
      commissionDeduction: Number(earnings.commissionDeduction),
      level: earnings.partnerLevel?.level || "BRONZE",
      levelPoints: earnings.partnerLevel?.points || 0,
    };
  } catch (err) {
    // Return default values on error
    return {
      todayEarnings: 0,
      weeklyEarnings: 0,
      monthlyEarnings: 0,
      lifetimeEarnings: 0,
      pendingEarnings: 0,
      withdrawableBalance: 0,
      completedJobs: 0,
      cancelledJobs: 0,
      averageRating: 0,
      incentives: 0,
      bonuses: 0,
      commissionDeduction: 0,
      level: "BRONZE",
      levelPoints: 0,
    };
  }
}

export async function updatePartnerEarnings(
  userId: string,
  amount: number,
  platformFee: number,
  type: string = "JOB_COMPLETION",
  walkingRequestId?: string,
  description?: string
): Promise<void> {
  const earnings = await prisma.partnerEarnings.findUnique({ where: { userId } });
  if (!earnings) {
    await prisma.partnerEarnings.create({
      data: { userId },
    });
  }

  const netAmount = amount - platformFee;

  // Update earnings summary
  await prisma.partnerEarnings.update({
    where: { userId },
    data: {
      todayEarnings: { increment: netAmount },
      weeklyEarnings: { increment: netAmount },
      monthlyEarnings: { increment: netAmount },
      lifetimeEarnings: { increment: netAmount },
      pendingEarnings: { increment: netAmount },
      withdrawableBalance: { increment: netAmount },
      completedJobs: { increment: 1 },
      commissionDeduction: { increment: platformFee },
      lastEarningAt: new Date(),
    },
  });

  // Create earning detail record
  await prisma.earningDetail.create({
    data: {
      earningsId: (await prisma.partnerEarnings.findUnique({ where: { userId } }))!.id,
      walkingRequestId,
      amount,
      type,
      description: description || `Earning from job completion`,
      platformFee,
      commissionDeduction: platformFee,
      netAmount,
      status: "PENDING",
    },
  });

  // Update wallet balance
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  if (wallet) {
    await prisma.wallet.update({
      where: { userId },
      data: { balance: { increment: netAmount } },
    });
  }

  // Create transaction record
  await prisma.transaction.create({
    data: {
      walletId: wallet?.id || "",
      userId,
      type: "CREDIT",
      amount: netAmount,
      description: description || `Payment for walking service`,
      referenceId: walkingRequestId,
    },
  });
}

export async function calculatePartnerLevel(userId: string): Promise<void> {
  const earnings = await prisma.partnerEarnings.findUnique({ where: { userId } });
  if (!earnings) return;

  let level = "BRONZE";
  let priorityRequests = false;
  let platformFeeDiscount = 0;
  let incentiveMultiplier = 1.0;
  let fastWithdrawal = false;
  let specialBadge: string | undefined;

  const completedJobs = earnings.completedJobs;
  const lifetimeEarnings = Number(earnings.lifetimeEarnings);
  const avgRating = Number(earnings.averageRating);

  // Diamond: 500+ jobs, ₹50000+ earnings, 4.8+ rating
  if (completedJobs >= 500 && lifetimeEarnings >= 50000 && avgRating >= 4.8) {
    level = "DIAMOND";
    priorityRequests = true;
    platformFeeDiscount = 50; // 50% fee discount
    incentiveMultiplier = 2.0;
    fastWithdrawal = true;
    specialBadge = "💎 Diamond Partner";
  }
  // Platinum: 200+ jobs, ₹20000+ earnings, 4.5+ rating
  else if (completedJobs >= 200 && lifetimeEarnings >= 20000 && avgRating >= 4.5) {
    level = "PLATINUM";
    priorityRequests = true;
    platformFeeDiscount = 30;
    incentiveMultiplier = 1.75;
    fastWithdrawal = true;
    specialBadge = "⭐ Platinum Partner";
  }
  // Gold: 100+ jobs, ₹10000+ earnings, 4.2+ rating
  else if (completedJobs >= 100 && lifetimeEarnings >= 10000 && avgRating >= 4.2) {
    level = "GOLD";
    priorityRequests = true;
    platformFeeDiscount = 20;
    incentiveMultiplier = 1.5;
    fastWithdrawal = false;
    specialBadge = "🥇 Gold Partner";
  }
  // Silver: 50+ jobs, ₹5000+ earnings, 4.0+ rating
  else if (completedJobs >= 50 && lifetimeEarnings >= 5000 && avgRating >= 4.0) {
    level = "SILVER";
    priorityRequests = false;
    platformFeeDiscount = 10;
    incentiveMultiplier = 1.25;
    fastWithdrawal = false;
    specialBadge = "🥈 Silver Partner";
  }

  // Update or create partner level
  const existingLevel = await prisma.partnerLevel.findUnique({ where: { userId } });
  if (existingLevel) {
    await prisma.partnerLevel.update({
      where: { userId },
      data: {
        level,
        priorityRequests,
        platformFeeDiscount,
        incentiveMultiplier,
        fastWithdrawal,
        specialBadge,
        points: completedJobs * 10 + Math.floor(lifetimeEarnings / 100),
      },
    });
  } else {
    await prisma.partnerLevel.create({
      data: {
        userId,
        level,
        priorityRequests,
        platformFeeDiscount,
        incentiveMultiplier,
        fastWithdrawal,
        specialBadge,
        points: completedJobs * 10 + Math.floor(lifetimeEarnings / 100),
      },
    });
  }
}

export async function getPriceEstimate(durationMinutes: number, options?: Partial<PriceCalculationOptions>): Promise<PriceBreakdown> {
  return calculatePrice({
    durationMinutes,
    ...options,
  });
}

export async function releasePayment(walkingRequestId: string): Promise<void> {
  const request = await prisma.walkingRequest.findUnique({
    where: { id: walkingRequestId },
    include: { acceptedBy: true },
  });

  if (!request || !request.acceptedById || !request.fare) {
    throw new Error("Invalid walking request or no fare set");
  }

  const priceBreakdown = await calculatePrice({
    durationMinutes: request.durationMinutes || 30,
  });

  const fareAmount = Number(request.fare);
  const partnerEarning = fareAmount - priceBreakdown.platformFee;

  // Update walking request status
  await prisma.walkingRequest.update({
    where: { id: walkingRequestId },
    data: {
      status: "COMPLETED",
      completedAt: new Date(),
      platformFee: priceBreakdown.platformFee,
      partnerEarning,
    },
  });

  // Update partner earnings
  await updatePartnerEarnings(
    request.acceptedById,
    fareAmount,
    priceBreakdown.platformFee,
    "JOB_COMPLETION",
    walkingRequestId,
    `Payment for walking service (${request.durationMinutes} min)`
  );

  // Recalculate partner level
  await calculatePartnerLevel(request.acceptedById);
}
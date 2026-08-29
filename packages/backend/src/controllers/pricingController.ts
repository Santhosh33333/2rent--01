import { Response } from "express";
import { prisma } from "../config/database";
import { sendSuccess, sendError } from "../utils/response";
import { AuthedRequest } from "../middleware/authTypes";
import { calculatePrice, getPartnerEarnings, getPriceEstimate, PriceCalculationOptions } from "../services/pricingEngine";

export async function getPriceBreakdown(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { durationMinutes, isPeakHour, isFestival, isRaining, isNight, waitingMinutes, couponCode, distanceKm } = req.query;

    if (!durationMinutes) {
      sendError(res, "Duration minutes is required.", 400, "MISSING_PARAMS");
      return;
    }

    const options: PriceCalculationOptions = {
      durationMinutes: parseInt(durationMinutes as string, 10),
      isPeakHour: isPeakHour === "true",
      isFestival: isFestival === "true",
      isRaining: isRaining === "true",
      isNight: isNight === "true",
      waitingMinutes: waitingMinutes ? parseInt(waitingMinutes as string, 10) : 0,
      couponCode: couponCode as string | undefined,
      distanceKm: distanceKm ? parseFloat(distanceKm as string) : 0,
    };

    const breakdown = await calculatePrice(options);
    sendSuccess(res, breakdown, "Price breakdown calculated.");
  } catch (err) {
    sendError(res, "Failed to calculate price.", 500, "INTERNAL_ERROR");
  }
}

export async function getEarningsDashboard(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const earnings = await getPartnerEarnings(userId);
    sendSuccess(res, earnings, "Earnings dashboard retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve earnings.", 500, "INTERNAL_ERROR");
  }
}

export async function getEarningDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;
    const type = req.query.type as string | undefined;

    const earnings = await prisma.partnerEarnings.findUnique({ where: { userId } });
    if (!earnings) {
      sendSuccess(res, { items: [], page, limit, total: 0 });
      return;
    }

    const where: any = { earningsId: earnings.id };
    if (type) where.type = type;

    const [items, total] = await Promise.all([
      prisma.earningDetail.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: { walkingRequest: { select: { id: true, startLocation: true, endLocation: true, durationMinutes: true } } },
      }),
      prisma.earningDetail.count({ where }),
    ]);

    sendSuccess(res, { items, page, limit, total });
  } catch (err) {
    sendError(res, "Failed to retrieve earning details.", 500, "INTERNAL_ERROR");
  }
}

export async function downloadStatement(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const { startDate, endDate } = req.query;

    const earnings = await prisma.partnerEarnings.findUnique({ where: { userId } });
    if (!earnings) {
      sendError(res, "No earnings found.", 404, "EARNINGS_NOT_FOUND");
      return;
    }

    const where: any = { earningsId: earnings.id };
    if (startDate) {
      where.createdAt = { ...where.createdAt, gte: new Date(startDate as string) };
    }
    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(endDate as string) };
    }

    const details = await prisma.earningDetail.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    // Generate CSV statement
    const header = "Date,Type,Amount,Platform Fee,Commission,Incentive,Bonus,Net Amount,Description\n";
    const rows = details.map(
      (d) =>
        `${d.createdAt.toISOString()},${d.type},${d.amount},${d.platformFee},${d.commissionDeduction},${d.incentive},${d.bonus},${d.netAmount},"${d.description || ""}"`
    );
    const csv = header + rows.join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=earnings-statement-${userId}.csv`);
    res.send(csv);
  } catch (err) {
    sendError(res, "Failed to generate statement.", 500, "INTERNAL_ERROR");
  }
}

export async function downloadReceipt(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const detail = await prisma.earningDetail.findUnique({
      where: { id },
      include: { walkingRequest: true },
    });

    if (!detail) {
      sendError(res, "Earning detail not found.", 404, "NOT_FOUND");
      return;
    }

    // Generate JSON receipt
    const receipt = {
      receiptId: `RCP-${detail.id.slice(0, 8).toUpperCase()}`,
      date: detail.createdAt.toISOString(),
      type: detail.type,
      amount: detail.amount,
      platformFee: detail.platformFee,
      commissionDeduction: detail.commissionDeduction,
      incentive: detail.incentive,
      bonus: detail.bonus,
      netAmount: detail.netAmount,
      description: detail.description,
      walkingRequest: detail.walkingRequest
        ? {
            id: detail.walkingRequest.id,
            startLocation: detail.walkingRequest.startLocation,
            endLocation: detail.walkingRequest.endLocation,
            durationMinutes: detail.walkingRequest.durationMinutes,
          }
        : null,
      status: detail.status,
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename=receipt-${receipt.receiptId}.json`);
    sendSuccess(res, receipt, "Receipt generated.");
  } catch (err) {
    sendError(res, "Failed to generate receipt.", 500, "INTERNAL_ERROR");
  }
}

export async function applyCoupon(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { code, amount } = req.body;

    if (!code || !amount) {
      sendError(res, "Coupon code and amount are required.", 400, "MISSING_PARAMS");
      return;
    }

    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) {
      sendError(res, "Invalid coupon code.", 404, "COUPON_NOT_FOUND");
      return;
    }

    if (!coupon.isActive) {
      sendError(res, "Coupon is no longer active.", 400, "COUPON_INACTIVE");
      return;
    }

    if (coupon.validFrom > new Date()) {
      sendError(res, "Coupon is not yet valid.", 400, "COUPON_NOT_VALID");
      return;
    }

    if (coupon.validTo < new Date()) {
      sendError(res, "Coupon has expired.", 400, "COUPON_EXPIRED");
      return;
    }

    if (amount < coupon.minAmount) {
      sendError(res, `Minimum order amount of ₹${coupon.minAmount} required.`, 400, "MIN_AMOUNT_NOT_MET");
      return;
    }

    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      sendError(res, "Coupon usage limit reached.", 400, "COUPON_EXHAUSTED");
      return;
    }

    let discount = 0;
    if (coupon.discountType === "PERCENTAGE") {
      discount = Math.round((amount * coupon.discountValue) / 100 * 100) / 100;
      if (coupon.maxDiscount && discount > coupon.maxDiscount) {
        discount = coupon.maxDiscount;
      }
    } else {
      discount = coupon.discountValue;
    }

    sendSuccess(res, {
      couponCode: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      discount,
      originalAmount: amount,
      finalAmount: Math.round((amount - discount) * 100) / 100,
    }, "Coupon applied successfully.");
  } catch (err) {
    sendError(res, "Failed to apply coupon.", 500, "INTERNAL_ERROR");
  }
}
import crypto from "crypto"
import { Response } from "express"
import { prisma } from "../config/database"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import * as bookingEngine from "../services/bookingEngine"
import * as razorpayService from "../services/razorpayService"
import * as partnerMatching from "../services/partnerMatchingEngine"
import { dispatchBooking, onBookingClaimed } from "../services/dispatchService"
import { SERVICE_KEYS } from "../services/serviceCatalog"
import { logBookingTransition } from "../services/bookingLogService"
import { buildReferralRewardService } from "./referralController"

const settleReferralReward = buildReferralRewardService()

// ============================================================================
// CREATE BOOKING
// ============================================================================

export async function createBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const rawServiceType = req.body.serviceType;
    const serviceTypes = Array.isArray(rawServiceType)
      ? rawServiceType
      : typeof rawServiceType === "string"
        ? [rawServiceType]
        : [];
    const normalizedServiceType = serviceTypes.find((type) => SERVICE_KEYS.includes(type));
    if (!normalizedServiceType) {
      sendError(res, "Unsupported service type.", 400, "INVALID_SERVICE");
      return;
    }
    const { startLocation, endLocation, scheduledAt, durationMinutes, itemType, itemDescription, notes, startLatitude, startLongitude, endLatitude, endLongitude, couponCode, distanceKm } = req.body;

    if (!startLocation || !endLocation) {
      sendError(res, "Start location and end location are required.", 400, "VALIDATION_ERROR");
      return;
    }

    // Bookings can only be scheduled from now up to 2 months (60 days) ahead.
    const BOOKING_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;
    const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
    if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
      sendError(res, "Please choose a valid date and time for the booking.", 400, "VALIDATION_ERROR");
      return;
    }
    if (scheduledDate.getTime() < Date.now() - 5 * 60 * 1000) {
      sendError(res, "Booking time must be in the future. Please pick a later slot.", 400, "BOOKING_TIME_IN_PAST");
      return;
    }
    if (scheduledDate.getTime() > Date.now() + BOOKING_WINDOW_MS) {
      sendError(res, "Bookings can only be made from today up to 2 months in advance.", 400, "BOOKING_WINDOW_EXCEEDED");
      return;
    }

    const booking = await bookingEngine.createBooking(userId, {
      serviceType: normalizedServiceType,
      startLocation,
      endLocation,
      scheduledAt,
      durationMinutes,
      itemType,
      itemDescription,
      notes,
      startLatitude,
      startLongitude,
      endLatitude,
      endLongitude,
      distanceKm,
      couponCode,
    });

    // Fan the job out to eligible partners (realtime + notifications).
    void dispatchBooking(booking.id);

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "BOOKING_CREATE",
        entityType: "Booking",
        entityId: booking.id,
        metadata: JSON.stringify({ serviceType: normalizedServiceType, serviceTypes }),
      },
    });

    void logBookingTransition({
      bookingId: booking.id,
      toStatus: booking.status,
      actorId: userId,
      actorType: "USER",
      note: "Booking created",
    });

    sendSuccess(res, booking, "Booking created.", 201);
  } catch (err: any) {
    if (err?.code === "INSUFFICIENT_BALANCE") {
      sendError(res, err.message, 400, "INSUFFICIENT_BALANCE");
      return;
    }
    if (err?.code === "MIN_DURATION") {
      sendError(res, err.message, 400, "MIN_DURATION");
      return;
    }
    sendError(res, "Failed to create booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET MY BOOKINGS
// ============================================================================

export async function getMyBookings(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const userId = req.user!.userId;
    const status = req.query.status as string | undefined;
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 20;

    const where: any = { userId };
    if (status) where.status = status;

    const [items, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        include: {
          partner: {
            select: {
              user: { select: { id: true, fullName: true, avatarUrl: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.booking.count({ where }),
    ]);

    sendSuccess(res, { items, total, page, limit });
  } catch (err: any) {
    sendError(res, "Failed to retrieve bookings.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET BOOKING DETAIL
// ============================================================================

export async function getBookingDetail(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        // Privacy: never expose phone numbers between user and partner.
        user: { select: { id: true, fullName: true, avatarUrl: true, city: true } },
        partner: {
          include: {
            user: { select: { id: true, fullName: true, avatarUrl: true } },
          },
        },
      },
    });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    const userId = req.user!.userId;
    const partnerUserId = booking.partner?.userId;

    if (booking.userId !== userId && partnerUserId !== userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    // Attach the partner's last-known real GPS so the map can show the current
    // position immediately, before the first live socket push arrives.
    const partnerLocation = booking.partnerId
      ? await prisma.partnerLocation.findUnique({ where: { partnerId: booking.partnerId } })
      : null;

    sendSuccess(res, { ...booking, partnerLocation: partnerLocation ?? null }, "Booking details retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to retrieve booking details.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// INITIATE PAYMENT
// ============================================================================

export async function initiatePayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params

    const booking = await prisma.booking.findUnique({ where: { id } })

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND")
      return
    }

    if (booking.userId !== req.user!.userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN")
      return
    }

    if (booking.status !== "PAYMENT_PENDING") {
      sendError(res, "Payment already initiated or booking is not in payment pending state.", 400, "INVALID_STATUS")
      return
    }

    const amount = booking.estimatedAmount ?? 0

    // Create Razorpay order
    const razorpayOrder = await razorpayService.createOrder(
      amount,
      "INR",
      `booking_${id}_${Date.now()}`,
      `Booking for ${booking.serviceType}`,
      {
        bookingId: id,
        userId: req.user!.userId,
        serviceType: booking.serviceType,
      }
    )

    // Update booking with razorpay order ID
    await prisma.booking.update({
      where: { id },
      data: {
        razorpayOrderId: razorpayOrder.id,
        status: "PAYMENT_INITIATED",
      },
    })

    // Persist a real payment record so Admin/Payment Center sees this order
    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } })
    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND")
      return
    }
    await prisma.paymentOrder.upsert({
      where: { razorpayOrderId: razorpayOrder.id },
      create: {
        razorpayOrderId: razorpayOrder.id,
        userId: req.user!.userId,
        walletId: wallet.id,
        amount,
        currency: "INR",
        status: "CREATED",
        type: "BOOKING",
        metadata: JSON.stringify({ bookingId: id, serviceType: booking.serviceType }),
      },
      update: { amount, metadata: JSON.stringify({ bookingId: id, serviceType: booking.serviceType }) },
    })

    // Log action
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "PAYMENT_INITIATED",
        entityType: "Booking",
        entityId: id,
        metadata: JSON.stringify({ 
          razorpayOrderId: razorpayOrder.id,
          amount,
        }),
      },
    })

    sendSuccess(
      res,
      {
        orderId: razorpayOrder.id,
        amount: Number(razorpayOrder.amount) / 100,
        currency: razorpayOrder.currency,
        bookingId: id,
      },
      "Order created. Proceed to payment."
    )
  } catch (err: any) {
    console.error("Payment initiation failed:", err)
    sendError(res, "Failed to initiate payment.", 500, "PAYMENT_INITIATION_FAILED")
  }
}

// ============================================================================
// VERIFY PAYMENT
// ============================================================================

export async function verifyPayment(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params
    const { razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body

    if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
      sendError(res, "Missing payment details.", 400, "MISSING_PAYMENT_DETAILS")
      return
    }

    const booking = await prisma.booking.findUnique({ where: { id } })

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND")
      return
    }

    if (booking.userId !== req.user!.userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN")
      return
    }

    if (booking.status === "PARTNER_SEARCHING" && booking.razorpayPaymentId) {
      // Idempotent replay: this booking's payment was already verified
      sendSuccess(
        res,
        { bookingId: id, paymentId: booking.razorpayPaymentId, amount: booking.finalAmount, status: "COMPLETED" },
        "Payment already verified."
      )
      return
    }

    if (booking.status !== "PAYMENT_INITIATED") {
      sendError(res, "Booking is not in correct state for payment verification.", 400, "INVALID_STATE")
      return
    }

    // Bind the payment to THIS booking's order — a captured payment for another
    // order must never confirm this booking.
    if (!booking.razorpayOrderId || booking.razorpayOrderId !== razorpayOrderId) {
      sendError(res, "Order does not match this booking.", 400, "ORDER_MISMATCH")
      return
    }

    // Verify Razorpay signature
    const isValid = razorpayService.verifyPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature)
    if (!isValid) {
      // Log failed verification attempt
      await prisma.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "PAYMENT_VERIFICATION_FAILED",
          entityType: "Booking",
          entityId: id,
          metadata: JSON.stringify({ razorpayPaymentId, reason: "Invalid signature" }),
        },
      })
      sendError(res, "Payment signature verification failed.", 400, "INVALID_SIGNATURE")
      return
    }

    // Fetch actual payment details from Razorpay to double-check
    const paymentDetails = await razorpayService.fetchPayment(razorpayPaymentId)
    
    if (!paymentDetails || paymentDetails.status !== "captured") {
      sendError(res, "Payment not captured in Razorpay.", 400, "PAYMENT_NOT_CAPTURED")
      return
    }

    const amount = Number(paymentDetails.amount) / 100 // Convert from paise
    
    if (amount !== booking.estimatedAmount) {
      sendError(res, "Payment amount mismatch.", 400, "AMOUNT_MISMATCH")
      return
    }

    // Payment is valid - update booking and wallet
    const user = await prisma.user.findUnique({ where: { id: req.user!.userId } })
    if (!user) {
      sendError(res, "User not found.", 404, "USER_NOT_FOUND")
      return
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } })
    if (!wallet) {
      sendError(res, "Wallet not found.", 404, "WALLET_NOT_FOUND")
      return
    }

    // Begin transaction: latch booking state, create transaction record.
    // The conditional update guarantees only ONE verification wins even under
    // parallel replays — no double ledger entries, no double matching trigger.
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id, userId: req.user!.userId, status: "PAYMENT_INITIATED", razorpayOrderId },
        data: {
          status: "PARTNER_SEARCHING",
          paymentVerifiedAt: new Date(),
          finalAmount: amount,
          razorpayPaymentId,
        },
      })

      if (claimed.count !== 1) {
        return null
      }

      const updatedBooking = await tx.booking.findUnique({ where: { id } })

      await tx.transaction.create({
        data: {
          walletId: wallet.id,
          userId: req.user!.userId,
          type: "DEBIT",
          status: "COMPLETED",
          amount,
          description: `Booking payment for ${booking.serviceType}`,
          referenceId: razorpayPaymentId,
          bookingId: id,
        },
      })

      // Settle the PaymentOrder row (latched with the same claim)
      await tx.paymentOrder.updateMany({
        where: { razorpayOrderId, status: { notIn: ["COMPLETED", "FAILED"] } },
        data: {
          razorpayPaymentId,
          status: "COMPLETED",
          completedAt: new Date(),
          metadata: JSON.stringify({ bookingId: id, serviceType: booking.serviceType, paymentStatus: "SUCCESS" }),
        },
      })

      await tx.auditLog.create({
        data: {
          actorId: req.user!.userId,
          actorType: "USER",
          action: "PAYMENT_VERIFIED",
          entityType: "Booking",
          entityId: id,
          metadata: JSON.stringify({
            razorpayPaymentId,
            amount,
            status: "COMPLETED",
          }),
        },
      })

      return updatedBooking
    })

    if (!result) {
      sendError(res, "Booking is not in correct state for payment verification.", 400, "INVALID_STATE")
      return
    }

    void logBookingTransition({
      bookingId: id,
      fromStatus: "PAYMENT_INITIATED",
      toStatus: "PARTNER_SEARCHING",
      actorId: req.user!.userId,
      actorType: "USER",
      note: "Payment verified, searching for partner",
    });

    // Send notification to user
    await prisma.notification.create({
      data: {
        userId: req.user!.userId,
        title: "Payment Successful",
        body: `Payment of ₹${amount} for your booking has been confirmed. We're searching for a partner.`,
        data: JSON.stringify({ bookingId: id, paymentId: razorpayPaymentId }),
      },
    })

    // Trigger partner matching in the background
    partnerMatching.assignPartnerToBooking(id, {
      serviceType: booking.serviceType,
      startLocation: booking.startLocation,
      endLocation: booking.endLocation,
      startLatitude: booking.startLatitude || undefined,
      startLongitude: booking.startLongitude || undefined,
      endLatitude: booking.endLatitude || undefined,
      endLongitude: booking.endLongitude || undefined,
      durationMinutes: booking.durationMinutes || undefined,
      userId: booking.userId,
    }).catch(err => console.error("[BOOKING] Partner matching error:", err));

    sendSuccess(
      res,
      {
        bookingId: id,
        paymentId: razorpayPaymentId,
        amount,
        status: "COMPLETED",
      },
      "Payment verified successfully. Searching for partners."
    )
  } catch (err: any) {
    console.error("Payment verification error:", err)
    sendError(res, "Failed to verify payment.", 500, "PAYMENT_VERIFICATION_ERROR")
  }
}

// ============================================================================
// ACCEPT BOOKING (Partner)
// ============================================================================

export async function acceptBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    if (partner.status !== "APPROVED") {
      sendError(res, "Only approved partners can accept bookings.", 403, "PARTNER_NOT_APPROVED");
      return;
    }

    // Atomic claim: only the FIRST partner to accept wins. Concurrent acceptors
    // get count=0 and a conflict response instead of silently overwriting.
    const claimed = await prisma.booking.updateMany({
      where: { id, status: "PARTNER_SEARCHING", partnerId: null },
      data: {
        partnerId: partner.id,
        status: "PARTNER_ACCEPTED",
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "Booking was already accepted by another partner.", 409, "ALREADY_ACCEPTED");
      return;
    }

    // Stop expiry timer, notify user + losing partners in realtime.
    void onBookingClaimed(id, req.user!.userId);

    void logBookingTransition({
      bookingId: id,
      fromStatus: "PARTNER_SEARCHING",
      toStatus: "PARTNER_ACCEPTED",
      actorId: req.user!.userId,
      actorType: "PARTNER",
      note: "Partner accepted booking",
    });

    const updated = await prisma.booking.findUnique({
      where: { id },
      include: { partner: { select: { id: true, userId: true } } },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_ACCEPT",
        entityType: "Booking",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Booking accepted.");
  } catch (err: any) {
    sendError(res, "Failed to accept booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// REJECT BOOKING (Partner)
// ============================================================================

export async function rejectBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    // Only the ASSIGNED partner may reject. A searching (unassigned) booking
    // cannot be cancelled by arbitrary partners browsing offers.
    if (booking.status !== "PARTNER_ACCEPTED" || booking.partnerId !== partner.id) {
      sendError(res, "Booking cannot be rejected at this stage.", 400, "INVALID_STATUS");
      return;
    }

    // Route through the engine so refund/cancel bookkeeping runs consistently.
    await bookingEngine.cancelBooking(id, "PARTNER", reason || "Partner rejected");

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_REJECT",
        entityType: "Booking",
        entityId: id,
      },
    });

    sendSuccess(res, undefined, "Booking rejected.");
  } catch (err: any) {
    sendError(res, "Failed to reject booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// START BOOKING (Partner)
// ============================================================================

export async function startBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    // Ownership + state enforced atomically: only the ASSIGNED partner can
    // start the booking, and only from an accepted/generated-OTP state.
    // Idempotent: if already IN_PROGRESS, return success without error.
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    if (booking.partnerId !== partner.id) {
      sendError(res, "This booking is not assigned to you.", 403, "FORBIDDEN");
      return;
    }
    if (booking.status === "IN_PROGRESS") {
      sendSuccess(res, booking, "Booking already in progress.");
      return;
    }

    const claimed = await prisma.booking.updateMany({
      where: {
        id,
        partnerId: partner.id,
        status: { in: ["PARTNER_ACCEPTED", "OTP_GENERATED"] },
      },
      data: {
        status: "IN_PROGRESS",
        startedAt: new Date(),
      },
    });

    if (claimed.count !== 1) {
      sendError(res, "Booking cannot be started at this stage.", 400, "INVALID_STATUS");
      return;
    }

    const updated = await prisma.booking.findUnique({ where: { id } });

    void logBookingTransition({
      bookingId: id,
      fromStatus: "PARTNER_ACCEPTED",
      toStatus: "IN_PROGRESS",
      actorId: req.user!.userId,
      actorType: "PARTNER",
      note: "Booking started",
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_START",
        entityType: "Booking",
        entityId: id,
      },
    });

    sendSuccess(res, updated, "Booking started.");
  } catch (err: any) {
    sendError(res, "Failed to start booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// COMPLETE BOOKING (Partner)
// ============================================================================

export async function completeBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { endLatitude, endLongitude } = req.body;

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    // Atomic completion: only the ASSIGNED partner, only while IN_PROGRESS.
    // Earnings credit lives in the SAME transaction so a completed booking can
    // never exist without its earnings entry (and vice versa).
    let grossEarnings = 0;
    let commissionPercent = 0;
    let commissionFee = 0;
    let netEarnings = 0;
    let actualDurationMinutes = 0;
    const { waitingMinutes } = req.body;
    const result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: {
          id,
          partnerId: partner.id,
          status: "IN_PROGRESS",
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          endLatitude: endLatitude || undefined,
          endLongitude: endLongitude || undefined,
        },
      });

      if (claimed.count !== 1) {
        return null;
      }

      const booking = await tx.booking.findUnique({ where: { id } });
      if (!booking) return null;

      // Final price is calculated server-side from the VERIFIED duration
      // (startedAt -> completedAt timer), using the frozen pricing snapshot so
      // confirmed bookings never change price. The prepaid wallet debit is
      // settled automatically (refund if the run was shorter than estimated).
      actualDurationMinutes =
        booking.startedAt && booking.completedAt
          ? Math.max(1, Math.round((booking.completedAt.getTime() - booking.startedAt.getTime()) / 60000))
          : (booking.durationMinutes || 0);

      const settled = await bookingEngine.finalizeBookingPrice(
        id,
        actualDurationMinutes,
        waitingMinutes ? Math.floor(Number(waitingMinutes)) : 0,
        tx
      );

      grossEarnings = settled.finalAmount;
      netEarnings = settled.partnerEarning;

      // Cash bookings are paid peer-to-peer; never credit the platform wallet.
      let bNotes: Record<string, any> = {};
      try {
        bNotes = booking.notes ? JSON.parse(booking.notes) : {};
      } catch {
        // ignore malformed notes
      }
      const isCash =
        (booking as any).paymentStatus === "PENDING_CASH" || bNotes.paymentMethod === "CASH";

      const wallet = await tx.wallet.upsert({
        where: { userId: partner.userId },
        create: { userId: partner.userId, balance: 0 },
        update: {},
      });

      if (!isCash) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: netEarnings } },
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            userId: partner.userId,
            bookingId: id,
            type: "PARTNER_EARNING",
            status: "COMPLETED",
            amount: netEarnings,
            description: `Earnings for booking ${id}`,
          },
        });
      }

      await tx.partnerEarnings.upsert({
        where: { userId: partner.userId },
        update: {
          lifetimeEarnings: { increment: netEarnings },
          completedJobs: { increment: 1 },
        },
        create: {
          userId: partner.userId,
          lifetimeEarnings: netEarnings,
          completedJobs: 1,
        },
      });

      return booking;
    });

    if (!result) {
      sendError(res, "Booking is not in progress or not assigned to you.", 400, "INVALID_STATUS");
      return;
    }

    const updated = result;

    void logBookingTransition({
      bookingId: id,
      fromStatus: "IN_PROGRESS",
      toStatus: "COMPLETED",
      actorId: req.user!.userId,
      actorType: "PARTNER",
      note: `Completed with net ₹${netEarnings} (commission ${commissionPercent}%)`,
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_COMPLETE",
        entityType: "Booking",
        entityId: id,
        metadata: JSON.stringify({
          grossEarnings,
          commissionPercent,
          commissionFee,
          netEarnings,
        }),
      },
    });

    // Referral rewards unlock on the referee's first completed booking.
    // Fire-and-forget: settlement is claim-guarded and must never block or
    // fail the completion path.
    void settleReferralReward(updated.userId);

    sendSuccess(res, updated, "Booking completed.");
  } catch (err: any) {
    sendError(res, "Failed to complete booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// CANCEL BOOKING
// ============================================================================

export async function cancelBookingHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    const userId = req.user!.userId;

    // Get the partner's userId if this booking has an assigned partner
    let partnerUserId: string | null = null;
    if (booking.partnerId) {
      const partner = await prisma.partner.findUnique({ where: { id: booking.partnerId }, select: { userId: true } });
      partnerUserId = partner?.userId ?? null;
    }

    if (booking.userId !== userId && partnerUserId !== userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    const cancelledBy = booking.userId === userId ? "USER" : "PARTNER";
    const result = await bookingEngine.cancelBooking(id, cancelledBy, reason);

    void logBookingTransition({
      bookingId: id,
      fromStatus: booking.status,
      toStatus: "CANCELLED",
      actorId: userId,
      actorType: cancelledBy === "USER" ? "USER" : "PARTNER",
      note: reason ? `Cancelled: ${reason}` : "Cancelled",
    });

    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "USER",
        action: "BOOKING_CANCEL",
        entityType: "Booking",
        entityId: id,
      },
    });

    sendSuccess(res, result, "Booking cancelled.");
  } catch (err: any) {
    sendError(res, "Failed to cancel booking.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// RATE BOOKING
// ============================================================================

export async function rateBooking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { score, comment } = req.body;

    if (!score || score < 1 || score > 5) {
      sendError(res, "Rating score must be between 1 and 5.", 400, "VALIDATION_ERROR");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    if (booking.userId !== req.user!.userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    if (booking.status !== "COMPLETED") {
      sendError(res, "Booking is not completed yet.", 400, "INVALID_STATUS");
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { id: booking.partnerId! },
    });

    if (!partner) {
      sendError(res, "Partner not found.", 404, "PARTNER_NOT_FOUND");
      return;
    }

    // One rating per rater per booking: replays and double-submits rejected.
    const alreadyRated = await prisma.rating.findFirst({
      where: { bookingId: id, raterId: req.user!.userId, targetType: "PARTNER" },
    });
    if (alreadyRated) {
      sendError(res, "You have already rated this booking.", 409, "ALREADY_RATED");
      return;
    }

    await prisma.rating.create({
      data: {
        raterId: req.user!.userId,
        ratedId: partner.userId,
        targetType: "PARTNER",
        ratingType: "BOOKING",
        bookingId: id,
        score,
        comment,
      },
    });

    const ratings = await prisma.rating.findMany({
      where: { ratedId: partner.userId, targetType: "PARTNER" },
      select: { score: true },
    });

    const averageRating =
      ratings.length > 0
        ? Math.round((ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length) * 10) / 10
        : 0;

    await prisma.partner.update({
      where: { id: partner.id },
      data: { averageRating, rating: averageRating },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_RATE",
        entityType: "Booking",
        entityId: id,
        metadata: JSON.stringify({ score }),
      },
    });

    sendSuccess(res, undefined, "Rating submitted successfully.");
  } catch (err: any) {
    sendError(res, "Failed to submit rating.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// RATE USER (Partner rates the customer after a completed booking)
// ============================================================================

export async function rateUserByPartner(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { score, comment } = req.body;

    if (!score || score < 1 || score > 5) {
      sendError(res, "Rating score must be between 1 and 5.", 400, "VALIDATION_ERROR");
      return;
    }

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });
    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    if (booking.partnerId !== partner.id) {
      sendError(res, "This booking is not assigned to you.", 403, "FORBIDDEN");
      return;
    }
    if (booking.status !== "COMPLETED") {
      sendError(res, "Booking is not completed yet.", 400, "INVALID_STATUS");
      return;
    }

    const alreadyRated = await prisma.rating.findFirst({
      where: { bookingId: id, raterId: req.user!.userId, targetType: "USER" },
    });
    if (alreadyRated) {
      sendError(res, "You have already rated this booking.", 409, "ALREADY_RATED");
      return;
    }

    await prisma.rating.create({
      data: {
        raterId: req.user!.userId,
        ratedId: booking.userId,
        targetType: "USER",
        ratingType: "BOOKING",
        bookingId: id,
        score,
        comment,
      },
    });

    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "BOOKING_RATE_USER",
        entityType: "Booking",
        entityId: id,
        metadata: JSON.stringify({ score }),
      },
    });

    sendSuccess(res, undefined, "Customer rating submitted.");
  } catch (err: any) {
    sendError(res, "Failed to submit customer rating.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// GET BOOKING RECEIPT
// ============================================================================

export async function getBookingReceipt(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const booking = await prisma.booking.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
        partner: {
          include: {
            // Privacy: partner's real phone number is never exposed.
            user: { select: { id: true, fullName: true } },
          },
        },
      },
    });

    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }

    const isCustomer = booking.userId === userId;
    const isAssignedPartner = !!booking.partnerId && booking.partner!.userId === userId;
    const isPrivileged = ["SUPER_ADMIN", "ADMIN", "MODERATOR", "SUPPORT"].includes(req.user!.activeRole || "");
    if (!isCustomer && !isAssignedPartner && !isPrivileged) {
      sendError(res, "You do not have access to this receipt.", 403, "FORBIDDEN");
      return;
    }

    const [transactions, ratings] = await Promise.all([
      prisma.transaction.findMany({
        where: { bookingId: id },
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          description: true,
          referenceId: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.rating.findMany({
        where: { bookingId: id },
        select: { raterId: true, ratedId: true, targetType: true, score: true, comment: true },
      }),
    ]);

    sendSuccess(res, {
      receipt: {
        receiptNo: `RCPT-${booking.id.slice(0, 8).toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        booking: {
          id: booking.id,
          serviceType: booking.serviceType,
          status: booking.status,
          scheduledAt: booking.scheduledAt,
          startedAt: booking.startedAt ?? null,
          completedAt: booking.completedAt ?? null,
          startLocation: booking.startLocation,
          endLocation: booking.endLocation,
          durationMinutes: booking.durationMinutes,
        },
        customer: isPrivileged || isAssignedPartner
          ? booking.user
          : { id: booking.user.id, nameMasked: maskName(booking.user.fullName) },
        partner: booking.partner
          ? {
              id: booking.partner.id,
              name: booking.partner.user.fullName,
              providesWalking: booking.partner.providesWalking,
              providesCarry: booking.partner.providesCarry,
            }
          : null,
        charges: {
          estimatedAmount: booking.estimatedAmount,
          finalAmount: booking.finalAmount ?? booking.estimatedAmount,
          platformFee: booking.platformFee,
          partnerEarning: booking.partnerEarning,
          couponCode: booking.couponCode ?? null,
          discountAmount: booking.discountAmount ?? null,
          paymentStatus: booking.paymentStatus,
          razorpayPaymentId: booking.razorpayPaymentId ?? null,
        },
        refund: booking.refundStatus
          ? {
              status: booking.refundStatus,
              amount: booking.refundAmount,
              initiatedAt: booking.refundInitiatedAt,
            }
          : null,
        transactions,
        ratings,
      },
    }, "Booking receipt retrieved.");
  } catch (err) {
    sendError(res, "Failed to retrieve booking receipt.", 500, "INTERNAL_ERROR");
  }
}

function maskName(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  return parts.map((p) => `${p[0]}.`).join(" ");
}

// ============================================================================
// GET PRICE ESTIMATE
// ============================================================================

export async function getPriceEstimate(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { serviceType, durationMinutes, startLatitude, startLongitude, endLatitude, endLongitude, distanceKm } = req.query;

    if (!serviceType) {
      sendError(res, "Service type is required.", 400, "MISSING_PARAMS");
      return;
    }
    const st = Array.isArray(serviceType) ? String(serviceType[0]) : String(serviceType);
    if (!SERVICE_KEYS.includes(st)) {
      sendError(res, "Unsupported service type.", 400, "INVALID_SERVICE");
      return;
    }

    const estimate = await bookingEngine.getPriceEstimate({
      serviceType: st,
      durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
      startLatitude: startLatitude ? Number(startLatitude) : undefined,
      startLongitude: startLongitude ? Number(startLongitude) : undefined,
      endLatitude: endLatitude ? Number(endLatitude) : undefined,
      endLongitude: endLongitude ? Number(endLongitude) : undefined,
      distanceKm: distanceKm ? Number(distanceKm) : undefined,
    });

    sendSuccess(res, estimate, "Price estimate calculated.");
  } catch (err: any) {
    sendError(res, "Failed to calculate price estimate.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SELECT PAYMENT METHOD (after partner accepts)
// ============================================================================
export async function selectPaymentMethod(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body; // 'ONLINE' | 'CASH'

    if (!['ONLINE', 'CASH'].includes(paymentMethod)) {
      sendError(res, 'Payment method must be ONLINE or CASH.', 400, 'VALIDATION_ERROR');
      return;
    }

    // Check preconditions before atomic update
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) { sendError(res, 'Booking not found.', 404, 'BOOKING_NOT_FOUND'); return; }
    if (booking.userId !== req.user!.userId) { sendError(res, 'Unauthorized.', 403, 'FORBIDDEN'); return; }
    if (!['PARTNER_ACCEPTED', 'OTP_GENERATED'].includes(booking.status)) {
      sendError(res, 'Payment method can only be selected after partner accepts.', 400, 'INVALID_STATUS');
      return;
    }
    let existingNotes: Record<string, any> = {};
    try { existingNotes = booking.notes ? JSON.parse(booking.notes) : {}; } catch { /* malformed */ }
    if (existingNotes.paymentMethod) {
      sendError(res, 'Payment method already selected.', 400, 'ALREADY_SELECTED');
      return;
    }

    // Atomic latch: only the first selectPaymentMethod call wins
    const newNotes = JSON.stringify({ ...existingNotes, paymentMethod });
    const claimed = await prisma.booking.updateMany({
      where: {
        id,
        userId: req.user!.userId,
        status: { in: ['PARTNER_ACCEPTED', 'OTP_GENERATED'] },
      },
      data: {
        notes: newNotes,
        paymentStatus: paymentMethod === 'CASH' ? 'PENDING_CASH' : booking.paymentStatus as any,
        status: paymentMethod === 'CASH' ? 'OTP_GENERATED' : undefined,
      },
    });

    if (claimed.count !== 1) {
      sendError(res, 'Failed to select payment method. Please try again.', 409, 'CONFLICT');
      return;
    }

    await prisma.auditLog.create({
      data: { actorId: req.user!.userId, actorType: 'USER', action: 'PAYMENT_METHOD_SELECTED', entityType: 'Booking', entityId: id, metadata: JSON.stringify({ paymentMethod }) },
    });

    await prisma.notification.create({
      data: { userId: req.user!.userId, title: paymentMethod === 'CASH' ? 'Cash Payment Selected' : 'Proceed to Online Payment', body: paymentMethod === 'CASH' ? `Pay ₹${booking?.estimatedAmount} directly to your partner after the service.` : `Complete your online payment to confirm booking.`, data: JSON.stringify({ bookingId: id }) },
    });

    sendSuccess(res, { paymentMethod }, paymentMethod === 'CASH' ? 'Cash payment selected. Booking confirmed.' : 'Online payment method selected. Please complete payment.');
  } catch (err: any) {
    console.error('selectPaymentMethod error:', err);
    sendError(res, 'Failed to select payment method.', 500, 'INTERNAL_ERROR');
  }
}

// ============================================================================
// CONFIRM CASH RECEIVED (Partner confirms after service completion)
// ============================================================================
export async function confirmCashReceived(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const booking = await prisma.booking.findUnique({ where: { id }, include: { partner: { select: { userId: true, id: true } } } });
    if (!booking) { sendError(res, 'Booking not found.', 404, 'BOOKING_NOT_FOUND'); return; }
    if (booking.partner?.userId !== req.user!.userId) { sendError(res, 'Only the assigned partner can confirm cash receipt.', 403, 'FORBIDDEN'); return; }

    let bookingNotes: Record<string, any> = {};
    try { bookingNotes = booking.notes ? JSON.parse(booking.notes) : {}; } catch { /* malformed notes */ }
    if (bookingNotes.paymentMethod !== 'CASH') { sendError(res, 'This booking does not use cash payment.', 400, 'NOT_CASH_BOOKING'); return; }
    if ((booking as any).paymentStatus === 'CASH_RECEIVED') { sendSuccess(res, { confirmed: true }, 'Cash receipt already confirmed.'); return; }
    if (booking.status !== 'COMPLETED') { sendError(res, 'Booking must be completed before confirming cash.', 400, 'INVALID_STATUS'); return; }

    const amount = booking.finalAmount ?? booking.estimatedAmount ?? 0;
    const feePercent = await bookingEngine.getPlatformFeePercent();
    const platformFee = booking.platformFee ?? Math.ceil((amount * feePercent) / 100);
    const partnerEarning = amount - platformFee;

    // Latch paymentStatus so repeated confirms cannot double-credit earnings.
    // Earnings stats are already credited once in completeBooking, so this only
    // records the cash acknowledgement (no second wallet/earnings credit).
    await prisma.$transaction(async (tx) => {
      const claimed = await (tx.booking as any).updateMany({
        where: { id, paymentStatus: 'PENDING_CASH' },
        data: { paymentStatus: 'CASH_RECEIVED', notes: JSON.stringify({ ...bookingNotes, cashConfirmedAt: new Date().toISOString() }) },
      });
      if (claimed.count !== 1) {
        throw new Error('ALREADY_CONFIRMED');
      }
      await tx.notification.create({ data: { userId: booking.userId, title: 'Cash Confirmed', body: `Your partner confirmed receipt of ₹${amount} cash.`, data: JSON.stringify({ bookingId: id }) } });
      await tx.auditLog.create({ data: { actorId: req.user!.userId, actorType: 'USER', action: 'CASH_CONFIRMED', entityType: 'Booking', entityId: id, metadata: JSON.stringify({ amount, partnerEarning }) } });
    });

    sendSuccess(res, { confirmed: true, amount, partnerEarning }, 'Cash receipt confirmed.');
  } catch (err: any) {
    if (err?.message === 'ALREADY_CONFIRMED') {
      sendSuccess(res, { confirmed: true }, 'Cash receipt already confirmed.');
      return;
    }
    console.error('confirmCashReceived error:', err);
    sendError(res, 'Failed to confirm cash receipt.', 500, 'INTERNAL_ERROR');
  }
}

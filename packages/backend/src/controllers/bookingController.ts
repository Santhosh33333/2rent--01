import crypto from "crypto"
import { Response } from "express"
import { prisma } from "../config/database"
import { sendSuccess, sendError } from "../utils/response"
import { AuthedRequest } from "../middleware/authTypes"
import * as bookingEngine from "../services/bookingEngine"
import * as razorpayService from "../services/razorpayService"
import * as partnerMatching from "../services/partnerMatchingEngine"
import { dispatchBooking, onBookingClaimed } from "../services/dispatchService"
import { ensureConversation } from "./messageController"
import { SERVICE_KEYS } from "../services/serviceCatalog"
import { logBookingTransition } from "../services/bookingLogService"
import {
  getEarlyStartMinutes,
  isExpired,
  isWithinStartWindow,
  issueCompletionOtp,
  issueStartOtp,
  markArrived,
  markTravelling,
  OTP_MAX_ATTEMPTS,
  parseNotes,
  requestCompletion,
  verifyOtpHash,
  verifyStartOtp,
} from "../services/jobWorkflowService"
import { checkAcceptStorm, checkInstantCompletion, checkOtpAbuse } from "../services/aiMonitorService"
import { calculateDistance } from "../utils/location"
import { getConfig } from "../services/pricingEngine"
import { buildReferralRewardService } from "./referralController"
import { env } from "../config/env"

const settleReferralReward = buildReferralRewardService()

/** Merge the same-gender-partner preference into booking notes (spec 101).
 *  Plain-text notes are preserved under `text`; the matcher enforces the flag. */
function mergeBookingPreference(notes: unknown, sameGenderOnly: unknown): string | undefined {
  if (sameGenderOnly !== true && sameGenderOnly !== "true") {
    return typeof notes === "string" ? notes : undefined;
  }
  let base: Record<string, any> = {};
  if (typeof notes === "string" && notes.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(notes);
      if (parsed && typeof parsed === "object") base = parsed;
      else base = { text: notes };
    } catch {
      base = { text: notes };
    }
  } else if (typeof notes === "string" && notes) {
    base = { text: notes };
  }
  return JSON.stringify({ ...base, sameGenderOnly: true });
}

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
    const { startLocation, endLocation, scheduledAt, durationMinutes, itemType, itemDescription, notes, startLatitude, startLongitude, endLatitude, endLongitude, couponCode, distanceKm, sameGenderOnly } = req.body;

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
      notes: mergeBookingPreference(notes, sameGenderOnly),
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
    if (status) {
      const list = String(status).split(",").map((s) => s.trim()).filter(Boolean);
      where.status = list.length > 1 ? { in: list } : list[0] ?? status;
    }

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
        key: env.RAZORPAY_KEY_ID,
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
    const razorpayPaymentId = req.body.razorpayPaymentId ?? req.body.razorpay_payment_id
    const razorpayOrderId = req.body.razorpayOrderId ?? req.body.razorpay_order_id
    const razorpaySignature = req.body.razorpaySignature ?? req.body.razorpay_signature

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
// MANUAL UPI / QR PAYMENT (temporary flow for personal UPI accounts)
// ============================================================================

// Returns the platform-configured UPI QR the user must pay externally.
export async function getUpiDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    if (booking.userId !== req.user!.userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }

    const [upiId, name, qr] = await Promise.all([
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ID" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_ACCOUNT_NAME" } }),
      prisma.pricingConfig.findUnique({ where: { key: "UPI_QR_URL" } }),
    ]);

    if (!upiId?.value) {
      sendError(res, "UPI payment is not configured by the admin yet.", 503, "UPI_NOT_CONFIGURED");
      return;
    }

    sendSuccess(
      res,
      {
        upiId: upiId.value,
        accountName: name?.value ?? null,
        qrUrl: qr?.value ?? null,
        amount: booking.estimatedAmount,
        currency: "INR",
        bookingId: id,
        referenceNote: `RB${id.slice(0, 8).toUpperCase()}`,
      },
      "Scan the QR, pay externally, then enter the UTR/reference number."
    );
  } catch (err: any) {
    console.error("getUpiDetails error:", err);
    sendError(res, "Failed to load UPI details.", 500, "INTERNAL_ERROR");
  }
}

// User submits the external UPI reference; booking waits for admin verification.
// Never auto-confirms — admin verifies against the bank statement first.
export async function submitUpiReference(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const referenceNumber = (req.body.referenceNumber ?? "").toString().trim();
    if (!referenceNumber || referenceNumber.length < 6) {
      sendError(res, "Enter a valid UTR / reference number (min 6 chars).", 400, "INVALID_REFERENCE");
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
    if (!["VERIFICATION_PENDING", "REJECTED", "REQUEST_INFO"].includes(booking.paymentStatus)) {
      sendError(res, "This booking is not awaiting UPI verification.", 400, "INVALID_STATUS");
      return;
    }

    // Prevent the same reference being reused for another booking (fraud guard).
    const duplicate = await prisma.upiPayment.findFirst({
      where: { referenceNumber, status: { in: ["VERIFICATION_PENDING", "VERIFIED", "REQUEST_INFO"] } },
    });
    if (duplicate) {
      sendError(res, "This reference number is already used for another booking.", 409, "DUPLICATE_REFERENCE");
      return;
    }

    const wallet = await prisma.wallet.findUnique({ where: { userId: req.user!.userId } });
    await prisma.upiPayment.create({
      data: {
        bookingId: id,
        userId: req.user!.userId,
        amount: booking.estimatedAmount ?? 0,
        currency: "INR",
        referenceNumber,
        status: "VERIFICATION_PENDING",
        metadata: JSON.stringify({ serviceType: booking.serviceType }),
      },
    });
    await prisma.booking.update({
      where: { id },
      data: { paymentStatus: "VERIFICATION_PENDING", paymentMethod: "UPI_MANUAL" },
    });
    await prisma.auditLog.create({
      data: {
        actorId: req.user!.userId,
        actorType: "USER",
        action: "UPI_REFERENCE_SUBMITTED",
        entityType: "Booking",
        entityId: id,
        metadata: JSON.stringify({ referenceNumber, walletId: wallet?.id ?? null }),
      },
    });

    sendSuccess(res, { status: "VERIFICATION_PENDING" }, "Reference submitted. Admin will verify the payment.");
  } catch (err: any) {
    console.error("submitUpiReference error:", err);
    sendError(res, "Failed to submit UPI reference.", 500, "INTERNAL_ERROR");
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

    // Anomaly watch: accepting far more jobs than plausible gets flagged
    // for admin review (never auto-punished).
    void checkAcceptStorm(req.user!.userId);

    // Open the User <-> assigned Partner conversation immediately so chat
    // works from the moment of acceptance (spec 102). Best-effort.
    void (async () => {
      try {
        const [b, p] = await Promise.all([
          prisma.booking.findUnique({ where: { id }, select: { userId: true } }),
          prisma.partner.findUnique({ where: { userId: req.user!.userId }, select: { userId: true } }),
        ]);
        if (b && p) {
          await ensureConversation(b.userId, p.userId);
          await prisma.notification.create({
            data: {
              userId: b.userId,
              title: "Partner assigned",
              body: "Your partner accepted. You can now chat from Messages.",
              data: JSON.stringify({ bookingId: id, type: "CHAT_READY" }),
            },
          });
        }
      } catch { /* never block accept */ }
    })();

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
    // start the booking, and only via a verified START OTP inside the
    // scheduled time window. Direct PARTNER_ACCEPTED -> IN_PROGRESS is
    // rejected (critical rule #84: accept means "upcoming", never started).
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
    if (booking.status !== "OTP_GENERATED") {
      sendError(res, "Start code verification is required before starting. Accept means upcoming — never started.", 409, "START_OTP_REQUIRED");
      return;
    }
    const notes = parseNotes(booking.notes);
    if (!notes.startOtp?.verifiedAt || !booking.otpVerifiedAt) {
      sendError(res, "Enter the start code from the user first (POST /:id/start-verify).", 409, "START_OTP_REQUIRED");
      return;
    }
    const early = await getEarlyStartMinutes(booking.serviceType);
    if (!isWithinStartWindow(new Date(booking.scheduledAt), new Date(), early)) {
      sendError(res, "This scheduled job cannot start before its time window.", 409, "TOO_EARLY");
      return;
    }

    const claimed = await prisma.booking.updateMany({
      where: {
        id,
        partnerId: partner.id,
        status: "OTP_GENERATED",
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
    const { endLatitude, endLongitude, completionOtp } = req.body;

    const partner = await prisma.partner.findUnique({
      where: { userId: req.user!.userId },
    });

    if (!partner) {
      sendError(res, "You are not registered as a partner.", 403, "NOT_PARTNER");
      return;
    }

    // Atomic completion: only the ASSIGNED partner, only from
    // COMPLETION_REQUESTED, and only with a valid COMPLETION OTP entered by
    // the partner (code shown to the user only). Direct IN_PROGRESS ->
    // COMPLETED is rejected — partners cannot force completion (rule #95).
    // Earnings credit lives in the SAME transaction so a completed booking can
    // never exist without its earnings entry (and vice versa).
    const pre = await prisma.booking.findUnique({ where: { id } });
    if (!pre) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    if (pre.partnerId !== partner.id) {
      sendError(res, "This booking is not assigned to you.", 403, "FORBIDDEN");
      return;
    }
    if (pre.status === "COMPLETED") {
      sendSuccess(res, pre, "Booking already completed.");
      return;
    }
    if (pre.status !== "COMPLETION_REQUESTED") {
      sendError(res, "Request completion first and enter the user's completion code. Direct completion is not allowed.", 409, "COMPLETION_OTP_REQUIRED");
      return;
    }
    const preNotes = parseNotes(pre.notes);
    if (!preNotes.completionOtp?.hash && !preNotes.completionOtp?.verifiedAt) {
      sendError(res, "No active completion code. Ask the user to generate it.", 409, "COMPLETION_OTP_REQUIRED");
      return;
    }
    if (!preNotes.completionOtp?.verifiedAt) {
      const code = (completionOtp ?? "").toString().trim();
      if (!code) {
        sendError(res, "Enter the completion code from the user.", 400, "COMPLETION_OTP_REQUIRED");
        return;
      }
      if (isExpired(preNotes.completionOtp?.expiresAt, new Date())) {
        sendError(res, "Completion code expired. Ask the user for a new one.", 410, "OTP_EXPIRED");
        return;
      }
      if ((preNotes.completionOtp?.attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
        sendError(res, "Too many wrong attempts. Ask the user for a new code.", 429, "OTP_LOCKED");
        return;
      }
      if (!verifyOtpHash(code, preNotes.completionOtp!.hash!)) {
        preNotes.completionOtp!.attempts = (preNotes.completionOtp!.attempts ?? 0) + 1;
        await prisma.booking.update({ where: { id }, data: { notes: JSON.stringify(preNotes) } });
        void checkOtpAbuse(id, "COMPLETION", preNotes.completionOtp!.attempts ?? 0);
        sendError(res, "Invalid completion code. Try again.", 400, "INVALID_OTP");
        return;
      }
      preNotes.completionOtp!.verifiedAt = new Date().toISOString();
    }
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
          status: "COMPLETION_REQUESTED",
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          endLatitude: endLatitude || undefined,
          endLongitude: endLongitude || undefined,
          notes: JSON.stringify(preNotes),
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
      sendError(res, "Completion code verification is required. Request completion first.", 400, "COMPLETION_OTP_REQUIRED");
      return;
    }

    const updated = result;

    void logBookingTransition({
      bookingId: id,
      fromStatus: "COMPLETION_REQUESTED",
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

    // Anomaly watch: implausibly fast jobs get flagged for admin review
    // (never auto-punished).
    void checkInstantCompletion(id);

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

// ============================================================================
// CONTROLLED JOB WORKFLOW (spec 84-100): OTP-gated start/completion.
// The start code and completion code are shown to the USER only; the partner
// enters them and the BACKEND verifies. No frontend-only verification.
// ============================================================================

function workflowError(res: Response, err: any, fallback: string): void {
  const code = err?.code ?? "INTERNAL_ERROR";
  const status = err?.status ?? (code === "BOOKING_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code === "INTERNAL_ERROR" ? 500 : 409);
  sendError(res, err?.message || fallback, status, code);
}

/** USER: get the START code (shown to user only, shared in person). */
export async function getStartOtp(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await issueStartOtp(id, req.user!.userId);
    sendSuccess(res, { bookingId: id, startOtp: result.otp, expiresAt: result.expiresAt }, "Share this code with your partner in person on arrival.");
  } catch (err: any) {
    workflowError(res, err, "Failed to generate start code.");
  }
}

/** PARTNER: GO TO JOB — opens the travel window (time-gated). */
export async function goToJob(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await markTravelling(id, req.user!.userId);
    sendSuccess(res, { bookingId: id, ...result }, "Navigation started. Travel safely.");
  } catch (err: any) {
    workflowError(res, err, "Failed to start travel.");
  }
}

/** PARTNER: "I've arrived" — notifies the user, does NOT start the job. */
export async function markArrivedHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await markArrived(id, req.user!.userId);
    sendSuccess(res, { bookingId: id, ...result }, "Arrival recorded. Ask the user for the start code.");
  } catch (err: any) {
    workflowError(res, err, "Failed to record arrival.");
  }
}

/** PARTNER: enter the user's START code — backend verifies, timer starts. */
export async function verifyStartOtpHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { startOtp } = req.body;
    const updated = await verifyStartOtp(id, req.user!.userId, (startOtp ?? "").toString().trim());
    sendSuccess(res, updated, "Job started. Timer is running.");
  } catch (err: any) {
    workflowError(res, err, "Failed to verify start code.");
  }
}

/** PARTNER: request completion — does NOT complete; user confirms via OTP. */
export async function requestCompletionHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const updated = await requestCompletion(id, req.user!.userId);
    sendSuccess(res, updated, "Completion requested. The user will confirm with a code.");
  } catch (err: any) {
    workflowError(res, err, "Failed to request completion.");
  }
}

/** USER: get the COMPLETION code (shown to user only, shared in person). */
export async function getCompletionOtp(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const result = await issueCompletionOtp(id, req.user!.userId);
    sendSuccess(res, { bookingId: id, completionOtp: result.otp, expiresAt: result.expiresAt }, "Share this code with your partner in person.");
  } catch (err: any) {
    workflowError(res, err, "Failed to generate completion code.");
  }
}

/** USER/PARTNER: live tracking snapshot (spec 109).
 *  Phase comes from backend trip state; position is the partner's real GPS.
 *  ETA is an honest estimate (great-circle distance at a configured city
 *  speed) — labelled as such, never exact location exposure beyond need. */
export async function getBookingTracking(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const booking = await prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      sendError(res, "Booking not found.", 404, "BOOKING_NOT_FOUND");
      return;
    }
    const userId = req.user!.userId;
    const partnerUser = booking.partnerId
      ? (await prisma.partner.findUnique({ where: { id: booking.partnerId }, select: { userId: true } }))?.userId ?? null
      : null;
    if (booking.userId !== userId && partnerUser !== userId) {
      sendError(res, "Unauthorized.", 403, "FORBIDDEN");
      return;
    }
    const notes = parseNotes(booking.notes);
    const phase = notes.trip?.phase ?? "NOT_STARTED";
    const partnerLocation = booking.partnerId
      ? await prisma.partnerLocation.findUnique({ where: { partnerId: booking.partnerId } })
      : null;

    // ETA estimate from REAL positions only; null when positions unknown.
    let etaMinutesEstimate: number | null = null;
    if (
      partnerLocation?.latitude != null && partnerLocation?.longitude != null &&
      booking.startLatitude != null && booking.startLongitude != null &&
      phase === "TRAVELLING"
    ) {
      const km = calculateDistance(
        partnerLocation.latitude, partnerLocation.longitude,
        booking.startLatitude, booking.startLongitude
      );
      const speedKmph = await getConfig("AVG_CITY_SPEED_KMPH", 25);
      const speed = Number.isFinite(speedKmph) && speedKmph > 0 ? speedKmph : 25;
      etaMinutesEstimate = Math.max(1, Math.round((km / speed) * 60));
    }

    sendSuccess(res, {
      bookingId: id,
      status: booking.status,
      phase,
      partnerLocation: partnerLocation
        ? { latitude: partnerLocation.latitude, longitude: partnerLocation.longitude, updatedAt: (partnerLocation as any).updatedAt ?? null }
        : null,
      etaMinutesEstimate,
      etaBasis: etaMinutesEstimate != null ? "great-circle distance at configured city speed; traffic-aware routing not included" : null,
      computedAt: new Date().toISOString(),
    }, "Tracking snapshot retrieved.");
  } catch {
    sendError(res, "Failed to retrieve tracking.", 500, "INTERNAL_ERROR");
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

    let estimate;
    try {
      estimate = await bookingEngine.getPriceEstimate({
        serviceType: st,
        durationMinutes: durationMinutes ? Number(durationMinutes) : undefined,
        startLatitude: startLatitude ? Number(startLatitude) : undefined,
        startLongitude: startLongitude ? Number(startLongitude) : undefined,
        endLatitude: endLatitude ? Number(endLatitude) : undefined,
        endLongitude: endLongitude ? Number(endLongitude) : undefined,
        distanceKm: distanceKm ? Number(distanceKm) : undefined,
      });
    } catch (calcErr: any) {
      console.error("Price calc error:", calcErr?.message);
      // Fallback: return a basic estimate so the user can still book
      const dur = durationMinutes ? Number(durationMinutes) : 30;
      const dist = distanceKm ? Number(distanceKm) : 0;
      estimate = {
        estimatedAmount: 50 + dur * 2 + dist * 2,
        platformFee: Math.round((50 + dur * 2 + dist * 2) * 0.1),
        partnerEarning: Math.round((50 + dur * 2 + dist * 2) * 0.9),
        baseFee: 50,
        timeCharge: dur * 2,
        distanceCharge: dist * 2,
        bookingFee: 0,
        serviceFee: 0,
        discount: 0,
        tax: 0,
        nightCharge: 0,
        rainCharge: 0,
        festivalMultiplier: 1,
        minApplied: false,
        platformFeePercent: 10,
        surgeApplied: false,
        surgeMultiplier: 1,
        distanceKm: dist,
        basePrice: 50,
      };
    }

    sendSuccess(res, estimate, "Price estimate calculated.");
  } catch (err: any) {
    console.error("getPriceEstimate error:", err?.message);
    sendError(res, "Failed to calculate price estimate.", 500, "INTERNAL_ERROR");
  }
}

// ============================================================================
// SELECT PAYMENT METHOD (after partner accepts)
// ============================================================================
export async function selectPaymentMethod(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { paymentMethod } = req.body; // 'ONLINE' | 'CASH' | 'UPI_MANUAL'

    if (!['ONLINE', 'CASH', 'UPI_MANUAL'].includes(paymentMethod)) {
      sendError(res, 'Payment method must be ONLINE, CASH or UPI_MANUAL.', 400, 'VALIDATION_ERROR');
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
        paymentStatus: paymentMethod === 'CASH' ? 'PENDING_CASH' : paymentMethod === 'UPI_MANUAL' ? 'VERIFICATION_PENDING' : booking.paymentStatus as any,
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

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';

/**
 * Detects duplicate bookings: same user, same service type, overlapping
 * time window (within 5 minutes). Prevents accidental double-taps.
 */
export async function preventDuplicateBooking(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as any).userId as string;
    const { serviceType, scheduledAt } = req.body ?? {};

    if (!userId || !serviceType || !scheduledAt) {
      return next();
    }

    const windowStart = new Date(new Date(scheduledAt).getTime() - 5 * 60 * 1000);
    const windowEnd = new Date(new Date(scheduledAt).getTime() + 5 * 60 * 1000);

    const existing = await prisma.booking.findFirst({
      where: {
        userId,
        serviceType,
        status: { in: ['PENDING', 'CONFIRMED', 'PARTNER_SEARCHING', 'PARTNER_ASSIGNED', 'IN_PROGRESS'] },
        scheduledAt: { gte: windowStart, lte: windowEnd },
      },
      select: { id: true, status: true, scheduledAt: true },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate booking detected. A similar booking already exists.',
        data: { existingBookingId: existing.id, status: existing.status },
      });
    }

    next();
  } catch (err) {
    console.error('[FRAUD] preventDuplicateBooking error (failing open):', err);
    next();
  }
}

/**
 * Detects duplicate payment verification: same booking + same amount within
 * 2 minutes. Prevents Razorpay webhook + manual verify double-processing.
 */
export async function preventDuplicatePayment(req: Request, res: Response, next: NextFunction) {
  try {
    const { razorpayPaymentId } = req.body ?? {};
    const bookingId = (req.params ? req.params.id : undefined) || (req.body ? req.body.bookingId : undefined);

    if (!bookingId) {
      return next();
    }

    const where: any = { bookingId };
    if (razorpayPaymentId) {
      where.razorpayPaymentId = razorpayPaymentId;
    }

    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000);
    where.createdAt = { gte: twoMinAgo };

    const existing = await prisma.paymentOrder.findFirst({
      where,
      select: { id: true, status: true },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'Duplicate payment detected. This payment was already processed.',
        data: { existingPaymentId: existing.id, status: existing.status },
      });
    }

    next();
  } catch (err) {
    console.error('[FRAUD] preventDuplicatePayment error (failing open):', err);
    next();
  }
}

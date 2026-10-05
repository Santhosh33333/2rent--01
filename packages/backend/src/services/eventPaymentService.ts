import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { holdShareInEscrow } from "./eventEscrowService";

/**
 * Event cost sheet.
 *
 * An organizer picks a per-person amount, usually from a common set. Everyone
 * registered then owes exactly that, the total is derived rather than typed, and
 * each attendee's share is tracked so "who still has to pay" is a real answer
 * instead of arithmetic in someone's head.
 *
 * Two rules shape everything here:
 *
 *  1. `Event.price` stays the single source of truth for the per-person ask.
 *     The schema already warns against duplicating a field that can silently
 *     disagree, so shares are recalculated FROM it rather than storing a
 *     competing "current rate".
 *
 *  2. Changing the ask must never rewrite history. A share that is already PAID
 *     keeps the amount it was paid at, and the money already collected stays
 *     collected. Only PENDING shares follow the new rate. This is what stops a
 *     price edit from silently refunding, or double-charging, anyone.
 */

/** Common per-person amounts. Served by the API so the UI never invents them. */
export const PRESET_AMOUNTS: number[] = [100, 200, 300, 500, 750, 1000, 1500, 2000];

/** Guards against a typo turning into an unbounded charge. */
export const MIN_SHARE_AMOUNT = 1;
export const MAX_SHARE_AMOUNT = 100_000;

export type ShareStatus = "PENDING" | "PAID" | "WAIVED";

export class EventPaymentError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = "EventPaymentError";
  }
}

function toRupees(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return Number(new Prisma.Decimal(value).toFixed(2));
}

/**
 * Normalises a rupee amount the organizer typed. Rejects anything that is not
 * whole paise-precision rupees, because a split across N people has to divide
 * cleanly enough to explain to a person.
 */
export function normaliseAmount(input: unknown): Prisma.Decimal {
  const n = typeof input === "string" ? Number(input.trim()) : input;
  if (typeof n !== "number" || !Number.isFinite(n)) {
    throw new EventPaymentError("Enter a valid amount.", "INVALID_AMOUNT");
  }
  const rounded = Math.round(n * 100) / 100;
  if (rounded < MIN_SHARE_AMOUNT) {
    throw new EventPaymentError(
      `The amount must be at least ₹${MIN_SHARE_AMOUNT}.`,
      "AMOUNT_TOO_LOW",
    );
  }
  if (rounded > MAX_SHARE_AMOUNT) {
    throw new EventPaymentError(
      `The amount cannot be more than ₹${MAX_SHARE_AMOUNT.toLocaleString("en-IN")}.`,
      "AMOUNT_TOO_HIGH",
    );
  }
  return new Prisma.Decimal(rounded.toFixed(2));
}

async function loadEventOrThrow(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      organizerId: true,
      price: true,
      currency: true,
      paymentStatus: true,
      paidAt: true,
      status: true,
      attendeeCount: true,
      capacity: true,
      // Needed to park the fee in escrow: the deadline the dispute window runs
      // to is derived from when the event actually ends.
      startTime: true,
      endTime: true,
    },
  });
  if (!event) throw new EventPaymentError("Event not found.", "EVENT_NOT_FOUND", 404);
  return event;
}

function assertOrganizer(event: { organizerId: string }, actorId: string) {
  if (event.organizerId !== actorId) {
    throw new EventPaymentError(
      "Only the organizer can change this.",
      "NOT_EVENT_ORGANIZER",
      403,
    );
  }
}

/**
 * The cost sheet, as the viewer is allowed to see it: the split is visible to
 * everyone on the event, but only the organizer sees the full payment list.
 */
export async function getCostSheet(eventId: string, viewerId?: string) {
  const event = await loadEventOrThrow(eventId);
  const isOrganizer = viewerId === event.organizerId;

  const [attendees, shares, organizerUpi] = await Promise.all([
    prisma.eventAttendee.findMany({
      where: { eventId },
      select: { userId: true, status: true },
    }),
    prisma.eventShare.findMany({
      where: { eventId },
      select: {
        userId: true,
        amount: true,
        status: true,
        method: true,
        methodRef: true,
        paidBy: true,
        paidAt: true,
      },
    }),
    isOrganizer
      ? prisma.walkingPartner.findUnique({
          where: { userId: event.organizerId },
          select: { upiId: true },
        })
      : Promise.resolve(null),
  ]);

  const perPerson = event.price === null ? null : toRupees(event.price);
  const shareByUser = new Map(shares.map((s) => [s.userId, s]));

  // The bill is every confirmed attendee. A cancelled or rejected attendee is
  // not charged, so counting them would inflate the total the organizer chases.
  const billable = attendees.filter((a) => a.status === "REGISTERED" || a.status === "ATTENDED");
  const headcount = billable.length;

  // When no rate is set the sheet still has to answer "how many people", so the
  // headcount is reported on its own rather than only as a total.
  const total = perPerson === null ? null : perPerson * headcount;

  const collected = shares.filter((s) => s.status === "PAID").reduce((sum, s) => sum + toRupees(s.amount), 0);
  const outstanding = shares
    .filter((s) => s.status === "PENDING")
    .reduce((sum, s) => sum + toRupees(s.amount), 0);

  const rows = (isOrganizer ? billable : [])
    .map((a) => {
      const share = shareByUser.get(a.userId);
      return {
        userId: a.userId,
        registrationStatus: a.status,
        amount: share ? toRupees(share.amount) : perPerson,
        status: (share?.status ?? "PENDING") as ShareStatus,
        method: share?.method ?? "WALLET",
        methodRef: share?.methodRef ?? null,
        paidBy: share?.paidBy ?? null,
        paidAt: share?.paidAt ?? null,
      };
    })
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));

  // The organizer can stop chasing once they are satisfied, which is why
  // paymentStatus exists separately from a derived "outstanding === 0".
  const collectionClosed = event.paymentStatus === "PAID";

  const youOwe = viewerId
    ? (() => {
        const share = shareByUser.get(viewerId);
        return share ? toRupees(share.amount) : 0;
      })()
    : 0;

  return {
    eventId: event.id,
    title: event.title,
    currency: event.currency,
    presets: PRESET_AMOUNTS,
    isOrganizer,
    perPerson,
    headcount,
    capacity: event.capacity,
    seatsLeft: event.capacity === null ? null : Math.max(0, event.capacity - headcount),
    // Derived, never entered: this is the whole point of the screen.
    total,
    collected,
    outstanding,
    collectionClosed,
    paidAt: event.paidAt,
    // Only ever the organizer's, and only when there is one to pay to. Sending
    // money to an id the platform did not verify is exactly the mistake this
    // avoids.
    organizerUpi: isOrganizer ? organizerUpi : null,
    youOwe,
    yourShareStatus: viewerId ? ((shareByUser.get(viewerId)?.status ?? "PENDING") as ShareStatus) : null,
    rows,
  };
}

/**
 * Sets the per-person amount and brings every unpaid share in line with it.
 * Idempotent, and safe to call when the amount is unchanged.
 */
export async function setPerPersonAmount(eventId: string, actorId: string, input: unknown) {
  const event = await loadEventOrThrow(eventId);
  assertOrganizer(event, actorId);

  if (event.status === "CANCELLED") {
    throw new EventPaymentError("This event has been cancelled.", "EVENT_CANCELLED");
  }

  const amount = normaliseAmount(input);

  const result = await prisma.$transaction(async (tx) => {
    await tx.event.update({ where: { id: eventId }, data: { price: Number(amount) } });

    const attendees = await tx.eventAttendee.findMany({
      where: { eventId, status: { in: ["REGISTERED", "ATTENDED"] } },
      select: { userId: true },
    });

    for (const { userId } of attendees) {
      const existing = await tx.eventShare.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { id: true, status: true },
      });

      if (!existing) {
        await tx.eventShare.create({ data: { eventId, userId, amount } });
      } else if (existing.status === "PENDING") {
        // Only unpaid shares follow the new rate.
        await tx.eventShare.update({ where: { id: existing.id }, data: { amount } });
      }
      // PAID and WAIVED shares are deliberately left untouched.
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "USER",
        action: "EVENT_SET_PRICE",
        entityType: "Event",
        entityId: eventId,
        metadata: JSON.stringify({ perPerson: Number(amount), attendees: attendees.length }),
      },
    });

    return { perPerson: Number(amount), attendees: attendees.length };
  });

  return { ...result, sheet: await getCostSheet(eventId, actorId) };
}

/** Gives a specific attendee a pass. Refuses once they have already paid. */
export async function waiveShare(eventId: string, actorId: string, userId: string) {
  const event = await loadEventOrThrow(eventId);
  assertOrganizer(event, actorId);

  const share = await prisma.eventShare.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { id: true, status: true },
  });
  if (!share) throw new EventPaymentError("That attendee has no share on this event.", "SHARE_NOT_FOUND", 404);
  if (share.status === "PAID") {
    throw new EventPaymentError("That share has already been paid.", "SHARE_ALREADY_PAID", 409);
  }

  await prisma.eventShare.update({ where: { id: share.id }, data: { status: "WAIVED" } });
  return getCostSheet(eventId, actorId);
}

/**
 * Pays the caller's own share from their wallet.
 *
 * Only ever the caller's own share: an attendee cannot settle someone else's,
 * because that would let one account move another account's money. Idempotent
 * through the PENDING guard, so a double tap cannot charge twice.
 */
export async function payMyShare(eventId: string, payerId: string) {
  const event = await loadEventOrThrow(eventId);
  if (event.status === "CANCELLED") {
    throw new EventPaymentError("This event has been cancelled.", "EVENT_CANCELLED");
  }
  // A fee cannot be taken for an event that is already under way: the organizer
  // can no longer buy a seat for someone who joins after the fact, so charging
  // would take money for a service that cannot exist.
  if (event.startTime.getTime() <= Date.now()) {
    throw new EventPaymentError(
      "This event has already started, so its fee can no longer be paid.",
      "EVENT_STARTED",
    );
  }

  await prisma.$transaction(async (tx) => {
    const registered = await tx.eventAttendee.findUnique({
      where: { eventId_userId: { eventId, userId: payerId } },
      select: { id: true },
    });
    if (!registered) {
      throw new EventPaymentError("You are not registered for this event.", "NOT_REGISTERED", 403);
    }

    // A share only exists once a rate is set. Charging before the organizer
    // names an amount is exactly the kind of guess the platform must not make.
    const share = await tx.eventShare.findUnique({
      where: { eventId_userId: { eventId, userId: payerId } },
      select: { id: true, amount: true, status: true },
    });
    if (!share) {
      throw new EventPaymentError(
        "The organizer has not set an amount for this event yet.",
        "NO_AMOUNT_SET",
      );
    }
    if (share.status === "PAID") {
      throw new EventPaymentError("You have already paid your share.", "SHARE_ALREADY_PAID", 409);
    }
    if (share.status === "WAIVED") {
      throw new EventPaymentError("Your share has been waived.", "SHARE_WAIVED", 409);
    }

    const wallet = await tx.wallet.findUnique({
      where: { userId: payerId },
      select: { id: true, balance: true, heldBalance: true },
    });
    if (!wallet) throw new EventPaymentError("No wallet was found for this account.", "WALLET_NOT_FOUND", 404);

    const amount = toRupees(share.amount);
    // Compare against SPENDABLE money, not raw balance. `balance` includes
    // anything already reserved for a metered call or another event, so testing
    // `balance` alone let a user commit the same rupees twice: the escrow hold
    // would succeed against a balance that was already spoken for. The guarded
    // UPDATE inside the hold repeats this same predicate against the live row,
    // which is what actually makes it safe under concurrency - this check is the
    // friendly error message, not the guarantee.
    const available = toRupees(Number(wallet.balance) - Number(wallet.heldBalance));
    if (available < amount) {
      throw new EventPaymentError(
        `Your wallet balance is too low for this payment. INR ${available.toFixed(2)} is available.`,
        "INSUFFICIENT_BALANCE",
      );
    }

    // The conditional update is the idempotency guard: only a share that is
    // still PENDING can transition, so a concurrent second request affects 0 rows.
    const claimed = await tx.eventShare.updateMany({
      where: { id: share.id, status: "PENDING" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (claimed.count === 0) {
      throw new EventPaymentError("You have already paid your share.", "SHARE_ALREADY_PAID", 409);
    }

    // The money is HELD, not spent. It leaves `balance` only if and when the
    // escrow is released to the organizer, and is fully refunded to the payer if
    // the event turns out to be fake. The old code decremented `balance` here
    // and nothing ever credited the organizer, so the fee simply vanished.
    await holdShareInEscrow(tx, {
      eventId,
      eventShareId: share.id,
      payerId,
      organizerId: event.organizerId,
      amount,
      startTime: event.startTime,
      endTime: event.endTime,
    });

    await tx.auditLog.create({
      data: {
        actorId: payerId,
        actorType: "USER",
        action: "EVENT_PAY_SHARE",
        entityType: "Event",
        entityId: eventId,
        metadata: JSON.stringify({ amount, shareId: share.id }),
      },
    });
  });

  return { paid: true, sheet: await getCostSheet(eventId, payerId) };
}
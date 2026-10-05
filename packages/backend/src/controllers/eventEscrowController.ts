/**
 * Event escrow: reporting, the dispute queue, and settlement decisions.
 *
 * The flow this exposes, end to end:
 *
 *   attendee pays a fee   -> money HELD, not spent        (eventPaymentService)
 *   event ends            -> 24h dispute window opens
 *   someone reports fake  -> every hold on the event FREEZES, payout stops
 *   admin decides         -> refund everyone, or release to the organizer
 *   no report in 24h      -> auto-released, nobody in the loop
 *
 * Two rules that shape every decision here:
 *
 *  - The system never decides an event was fake. Freezing is mechanical; the
 *    verdict is human. An automated "refund because there was a report" would
 *    let one malicious attendee drain any event's money.
 *
 *  - Every settlement carries a note, and that note is emailed to the payers. A
 *    refund without a reason is not an answer, so the note is required at the
 *    service layer rather than merely at the form.
 */
import type { Request, Response } from "express";
import { prisma } from "../config/database";
import {
  EscrowError,
  eventEscrowSummary,
  freezeAllEscrowsForEvent,
  freezeEscrowForReport,
  refundEscrow,
  releaseEscrow,
  sweepReleasableEscrows,
} from "../services/eventEscrowService";
import { canStillReport } from "../services/eventJoinPolicy";
import { sendSuccess, sendError as sendErrorRaw } from "../utils/response";
import { auditAdminAction } from "../rbac/audit";

const REASONS = ["NO_SHOW", "FAKE_EVENT", "MISLEADING_DETAILS", "UNSAFE", "OTHER"] as const;

function authId(req: Request): string {
  return (req as any).user?.userId as string;
}

/**
 * Error helper in the argument order this file reads best.
 *
 * The shared `sendError` takes (message, status, code), which is easy to invert
 * silently: passing a number where a string is expected produces a 200 response
 * carrying a nonsense message. Aliasing the import and wrapping it means a
 * mistake here is a type error rather than a wrong status code in production.
 */
const bad = (
  res: Response,
  status: number,
  message: string,
  code: string,
  extra?: Record<string, unknown>,
) => sendErrorRaw(res, message, status, code, undefined, extra);

/**
 * In-app notification.
 *
 * Best-effort by design: a failed push must never roll back a settlement the
 * money has already moved for. Hence the swallowed error - the settlement is the
 * thing that matters, and the notification is how the user finds out afterwards.
 */
async function notify(
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>,
): Promise<void> {
  await prisma.notification
    .create({ data: { userId, title, body, data: JSON.stringify(data) } })
    .catch(() => undefined);
}

/** Translates a service error into an HTTP response without hiding its code. */
function fail(res: Response, err: unknown) {
  const e = err as EscrowError;
  const code = e?.code ?? "EVENT_ESCROW_ERROR";
  const status = typeof e?.status === "number" ? e.status : 400;
  bad(res, status, e?.message ?? "Something went wrong.", code);
}

/**
 * POST /api/events/:id/report
 *
 * An attendee (or anyone who was there) reports the event as fake, unsafe, or
 * never held. This is the action that stops the payout.
 *
 * Reports are accepted up to and including the instant the money auto-releases,
 * and every open report freezes the WHOLE event's money rather than just the
 * reporter's own hold. That is deliberate: if the event was fake, every payer was
 * taken in, and refunding only whoever noticed first would reward whoever
 * reported soonest rather than whoever was actually wronged.
 */
export async function reportEvent(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  const userId = authId(req);
  const reason = String(req.body?.reason ?? "").trim().toUpperCase();
  const description = String(req.body?.description ?? "").trim().slice(0, 2000);

  if (!REASONS.includes(reason as any)) {
    bad(res,
      422,
      `Choose a reason: ${REASONS.join(", ")}.`,
      "INVALID_REPORT_REASON",
    );
    return;
  }
  // A bare reason with nothing said is not reviewable. One short sentence is
  // enough; this is not a form.
  if (description.length < 10) {
    bad(res,
      422,
      "Please describe what happened in at least a few words, so an admin can review it.",
      "REPORT_DESCRIPTION_REQUIRED",
    );
    return;
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizerId: true, startTime: true, endTime: true },
    });
    if (!event) {
      bad(res, 404, "Event not found.", "EVENT_NOT_FOUND");
      return;
    }

    // The deadline comes from the earliest still-held escrow on this event, so
    // the check matches what the payer was actually told at payment time.
    const earliest = await prisma.eventEscrow.findFirst({
      where: { eventId, status: { in: ["HELD", "DISPUTED"] } },
      orderBy: { releaseEligibleAt: "asc" },
      select: { id: true, releaseEligibleAt: true, payerId: true },
    });
    if (!earliest) {
      bad(res,
        409,
        "This event's payments have already been settled, so a report can no longer freeze them.",
        "TOO_LATE_TO_REPORT",
      );
      return;
    }
    if (!canStillReport(earliest.releaseEligibleAt, new Date())) {
      bad(res,
        409,
        "The 24-hour review window for this event has closed.",
        "DISPUTE_WINDOW_CLOSED",
      );
      return;
    }

    // One open report per person per event. Re-reporting must not multiply
    // freezes or flood the admin queue with the same complaint.
    const already = await prisma.eventReport.findFirst({
      where: { eventId, reporterId: userId, status: "OPEN" },
      select: { id: true },
    });
    if (already) {
      bad(res,
        409,
        "You have already reported this event. An admin will review it.",
        "ALREADY_REPORTED",
      );
      return;
    }

    const report = await prisma.$transaction(async (tx) => {
      const created = await tx.eventReport.create({
        data: { eventId, reporterId: userId, reason, description },
        select: { id: true, createdAt: true },
      });
      // Freeze this reporter's own hold if they paid...
      if (earliest.payerId === userId) {
        await freezeEscrowForReport(tx, earliest.id, new Date());
      }
      return created;
    });

    // Then freeze everything else on the event, outside that transaction so a
    // failure here cannot roll back the report the user just successfully filed.
    const frozen = await freezeAllEscrowsForEvent(eventId, new Date());

    // Tell the organizer their money is frozen. Not optional: an organizer whose
    // payout just stopped with no explanation will assume the platform stole it.
    await notify(
      event.organizerId,
      "Payments for your event are on hold",
      `"${event.title}" has been reported. The fee money is held until an admin reviews it.`,
      { eventId, reportId: report.id, type: "EVENT_PAYOUT_FROZEN" },
    );

    sendSuccess(res, {
      reportId: report.id,
      frozenHold: frozen,
      message:
        "Thank you. The money for this event is on hold and an admin will review it. " +
        "You will get an email with the outcome.",
    });
  } catch (err) {
    fail(res, err);
  }
}

/**
 * GET /api/events/:id/escrow
 *
 * What the money is doing, for the organizer. Deliberately aggregate: the
 * organizer needs to know how much is held, released and pending, not a per
 * attendee ledger of who paid what.
 */
export async function getEventEscrowStatus(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  const userId = authId(req);

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizerId: true, startTime: true, endTime: true },
    });
    if (!event) {
      bad(res, 404, "Event not found.", "EVENT_NOT_FOUND");
      return;
    }
    if (event.organizerId !== userId) {
      bad(res, 403, "Only the organizer can see this.", "NOT_ORGANIZER");
      return;
    }

    const summary = await eventEscrowSummary(eventId);
    const openReports = await prisma.eventReport.count({ where: { eventId, status: "OPEN" } });
    sendSuccess(res, {
      eventId,
      title: event.title,
      settlementStatus: (
        await prisma.event.findUnique({
          where: { id: eventId },
          select: { settlementStatus: true },
        })
      )?.settlementStatus,
      openReports,
      ...summary,
    });
  } catch (err) {
    fail(res, err);
  }
}

/**
 * GET /api/admin/event-disputes
 *
 * The admin queue: every event with money held and something against it.
 */
export async function listEventDisputes(req: Request, res: Response): Promise<void> {
  try {
    const events = await prisma.event.findMany({
      where: {
        OR: [
          { settlementStatus: "IN_DISPUTE" },
          { reports: { some: { status: "OPEN" } } },
        ],
      },
      select: {
        id: true,
        title: true,
        startTime: true,
        endTime: true,
        organizerId: true,
        settlementStatus: true,
        organizer: { select: { fullName: true, email: true } },
        _count: { select: { attendees: true } },
        reports: {
          where: { status: "OPEN" },
          select: {
            id: true,
            reason: true,
            description: true,
            createdAt: true,
            reporter: { select: { fullName: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { startTime: "desc" },
      take: 100,
    });

    const withMoney = await Promise.all(
      events.map(async (e) => ({
        ...e,
        money: await eventEscrowSummary(e.id),
      })),
    );

    sendSuccess(res, { disputes: withMoney, count: withMoney.length });
  } catch (err) {
    fail(res, err);
  }
}

/**
 * POST /api/admin/events/:id/settle
 *
 * The decision. `decision` is RELEASE or REFUND, applied to EVERY hold on the
 * event, because a report is about the event and not about one attendee.
 *
 * Settles one escrow per transaction and counts failures instead of throwing on
 * the first one: a partial settlement that reported failure would leave the admin
 * unsure whether anything moved, and retrying blindly could double-pay the ones
 * that already succeeded. Each individual failure is idempotent (ALREADY_SETTLED)
 * so a retry is safe.
 */
export async function decideEventSettlement(req: Request, res: Response): Promise<void> {
  const eventId = req.params.id;
  const adminId = authId(req);
  const decision = String(req.body?.decision ?? "").trim().toUpperCase();
  const note = String(req.body?.note ?? "").trim();

  if (decision !== "RELEASE" && decision !== "REFUND") {
    bad(res, 422, "Decision must be RELEASE or REFUND.", "INVALID_DECISION");
    return;
  }

  try {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true, organizerId: true },
    });
    if (!event) {
      bad(res, 404, "Event not found.", "EVENT_NOT_FOUND");
      return;
    }

    const escrows = await prisma.eventEscrow.findMany({
      where: { eventId, status: { in: ["HELD", "DISPUTED"] } },
      select: { id: true },
    });
    if (!escrows.length) {
      bad(res,
        409,
        "There is no money left to settle on this event.",
        "NOTHING_TO_SETTLE",
      );
      return;
    }

    const settle = decision === "RELEASE" ? releaseEscrow : refundEscrow;
    const results: Array<{ escrowId: string; ok: boolean; error?: string }> = [];
    for (const e of escrows) {
      try {
        await settle(e.id, adminId, note);
        results.push({ escrowId: e.id, ok: true });
      } catch (err: any) {
        results.push({ escrowId: e.id, ok: false, error: err?.code ?? "FAILED" });
      }
    }

    const settled = results.filter((r) => r.ok).length;

    // Tell everyone affected. The note is required precisely so this message can
    // say WHY, not just that something happened.
    const payers = await prisma.eventEscrow.findMany({
      where: { eventId, status: decision },
      select: { payerId: true },
    });
    await Promise.all(
      payers.map((p) =>
        notify(
          p.payerId,
          decision === "RELEASE"
            ? `Payment released for "${event.title}"`
            : `Payment refunded for "${event.title}"`,
          decision === "RELEASE"
            ? `Your fee for ${event.title} has been released to the organizer.`
            : `Your fee for ${event.title} has been returned to your wallet. ${note}`,
          { eventId, type: decision === "RELEASE" ? "EVENT_PAYOUT_RELEASED" : "EVENT_PAYOUT_REFUNDED" },
        ),
      ),
    );

    // Close the reports that this decision resolved.
    await prisma.eventReport.updateMany({
      where: { eventId, status: "OPEN" },
      data: {
        status: decision === "RELEASE" ? "RELEASED" : "REFUNDED",
        resolutionNote: note,
        resolvedById: adminId,
        resolvedAt: new Date(),
      },
    });

    await auditAdminAction({
      req,
      actorId: adminId,
      action: `EVENT_SETTLE_${decision}`,
      section: "EVENTS",
      targetType: "Event",
      targetId: eventId,
      newValue: { decision, note, settled, attempted: escrows.length },
    });

    sendSuccess(res, {
      decision,
      settled,
      attempted: escrows.length,
      // Reported rather than hidden: a partial settlement is the one case an
      // operator must look at, and a silent count would invite a blind retry.
      failures: results.filter((r) => !r.ok),
      notifiedPayers: payers.length,
    });
  } catch (err) {
    fail(res, err);
  }
}

/**
 * POST /api/admin/events/sweep-escrow
 *
 * On-demand run of the auto-release sweep, for when an operator wants it to
 * happen now rather than at the next tick.
 */
export async function runEscrowSweep(req: Request, res: Response): Promise<void> {
  try {
    const result = await sweepReleasableEscrows();
    await auditAdminAction({
      req,
      actorId: authId(req),
      action: "EVENT_ESCROW_SWEEP",
      section: "EVENTS",
      targetType: "EventEscrow",
      targetId: "sweep",
      newValue: result,
    });
    sendSuccess(res, result);
  } catch (err) {
    fail(res, err);
  }
}

/**
 * GET /api/me/escrow
 *
 * What is held on the caller's own behalf, and why. A user whose money is frozen
 * deserves to be able to ask without contacting support.
 */
export async function getMyEscrow(req: Request, res: Response): Promise<void> {
  const userId = authId(req);
  try {
    const rows = await prisma.eventEscrow.findMany({
      where: { payerId: userId },
      select: {
        id: true,
        amount: true,
        status: true,
        releaseEligibleAt: true,
        refundedAt: true,
        releasedAt: true,
        decisionNote: true,
        event: { select: { id: true, title: true, endTime: true, startTime: true } },
      },
      orderBy: { heldAt: "desc" },
      take: 100,
    });

    const n = (v: unknown) => Math.round(Number(v) * 100) / 100;
    const now = new Date();
    sendSuccess(res, {
      items: rows.map((r) => ({
        escrowId: r.id,
        eventId: r.event.id,
        eventTitle: r.event.title,
        amount: n(r.amount),
        status: r.status,
        // The deadline is reported exactly as stored, not recomputed, so the date
        // shown here is the same one shown at payment time.
        releaseEligibleAt: r.releaseEligibleAt,
        awaitingDecision: r.status === "DISPUTED",
        note: r.decisionNote,
        settledAt: r.refundedAt ?? r.releasedAt,
        // Whether the sweep will auto-release this if nothing else happens.
        autoReleasesAt:
          r.status === "HELD" && r.releaseEligibleAt.getTime() > now.getTime()
            ? r.releaseEligibleAt
            : null,
      })),
    });
  } catch (err) {
    fail(res, err);
  }
}
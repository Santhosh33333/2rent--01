import crypto from "crypto";
import { prisma } from "../config/database";
import { getConfig } from "./pricingEngine";
import { assertTransition } from "./bookingStateMachine";
import { logBookingTransition } from "./bookingLogService";
import { checkOtpAbuse } from "./aiMonitorService";

// ============================================================================
// Controlled job workflow service (spec sections 84-100).
//
// Rules enforced here:
// - PARTNER_ACCEPTED is "upcoming": no direct start/complete.
// - Start requires: time window open + verified START OTP (backend only).
// - Completion requires: explicit request + verified COMPLETION OTP.
// - Timer is server time (startedAt/completedAt set by backend, never client).
// ============================================================================

export const START_OTP_TTL_MIN = 15;
export const COMPLETION_OTP_TTL_MIN = 15;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LENGTH = 6;

export type TripPhase = "NOT_STARTED" | "TRAVELLING" | "ARRIVED";

export interface WorkflowNotes {
  startOtp?: { hash?: string; expiresAt?: string; attempts?: number; verifiedAt?: string | null };
  completionOtp?: { hash?: string; expiresAt?: string; attempts?: number; verifiedAt?: string | null };
  trip?: { phase?: TripPhase; travellingAt?: string | null; arrivedAt?: string | null; completionRequestedAt?: string | null };
  [k: string]: any;
}

export function parseNotes(raw: string | null | undefined): WorkflowNotes {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as WorkflowNotes) : {};
  } catch {
    return {};
  }
}

export function generateOtp(length: number = OTP_LENGTH): string {
  let otp = "";
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) otp += "0123456789"[bytes[i] % 10];
  return otp;
}

export function hashOtp(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

export function verifyOtpHash(otp: string, hash: string): boolean {
  if (!otp || !hash) return false;
  const a = Buffer.from(hashOtp(otp));
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function isExpired(expiresAtIso: string | undefined, now: Date = new Date()): boolean {
  if (!expiresAtIso) return true;
  const t = new Date(expiresAtIso).getTime();
  return !Number.isFinite(t) || t <= now.getTime();
}

/** Partner may act (go-to-job / start) only once the time window opens. */
export function isWithinStartWindow(scheduledAt: Date, now: Date, earlyMinutes: number): boolean {
  return now.getTime() >= scheduledAt.getTime() - earlyMinutes * 60_000;
}

export async function getEarlyStartMinutes(serviceType = "WALKING"): Promise<number> {
  try {
    const scoped = await getConfig(`${serviceType}_EARLY_START_MINUTES`, NaN as unknown as number);
    if (Number.isFinite(scoped) && scoped >= 0) return scoped;
  } catch { /* fall through */ }
  const general = await getConfig("EARLY_START_MINUTES", 30);
  return Number.isFinite(general) && general >= 0 ? general : 30;
}

function otpError(code: string, message: string, status = 400): Error {
  return Object.assign(new Error(message), { code, status }) as Error;
}

async function getBookingOrThrow(id: string) {
  const booking = await prisma.booking.findUnique({ where: { id } });
  if (!booking) throw otpError("BOOKING_NOT_FOUND", "Booking not found.", 404);
  return booking;
}

// --- START OTP: issued to the USER only, after accept -----------------------
// Explicit user pull ROTATES the code (old one dies) so the on-screen code is
// always the live one. Auto-issue (arrival) never rotates a still-valid code.

function startOtpAlive(notes: WorkflowNotes, now: Date): boolean {
  const rec = notes.startOtp;
  return !!rec?.hash && !rec.verifiedAt && !isExpired(rec.expiresAt, now) && (rec.attempts ?? 0) < OTP_MAX_ATTEMPTS;
}

function completionOtpAlive(notes: WorkflowNotes, now: Date): boolean {
  const rec = notes.completionOtp;
  return !!rec?.hash && !rec.verifiedAt && !isExpired(rec.expiresAt, now) && (rec.attempts ?? 0) < OTP_MAX_ATTEMPTS;
}

/** Issue a fresh START OTP row (hash only persisted). Returns plaintext once. */
async function mintStartOtp(bookingId: string, booking: { status: string; userId: string; notes: string | null }, now: Date) {
  const otp = generateOtp();
  const notes = parseNotes(booking.notes);
  notes.startOtp = {
    hash: hashOtp(otp),
    expiresAt: new Date(now.getTime() + START_OTP_TTL_MIN * 60_000).toISOString(),
    attempts: 0,
    verifiedAt: null,
  };
  if (!notes.trip) notes.trip = { phase: "NOT_STARTED" };

  const target = booking.status === "PARTNER_ACCEPTED" ? "OTP_GENERATED" : booking.status;
  if (target !== booking.status) assertTransition(booking.status, target);

  await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: target,
      otp: hashOtp(otp),
      otpGeneratedAt: now,
      otpVerifiedAt: null,
      notes: JSON.stringify(notes),
    },
  });
  return { otp, expiresAt: notes.startOtp.expiresAt as string };
}

export async function issueStartOtp(bookingId: string, actorUserId: string, now = new Date()) {
  const booking = await getBookingOrThrow(bookingId);
  if (booking.userId !== actorUserId) throw otpError("FORBIDDEN", "Only the booking owner can view the start code.", 403);
  if (!booking.partnerId) throw otpError("NO_PARTNER", "A partner must accept first.", 409);
  if (!["PARTNER_ACCEPTED", "OTP_GENERATED"].includes(booking.status)) {
    throw otpError("INVALID_STATUS", "Start code is available only for accepted upcoming jobs.", 409);
  }

  const { otp, expiresAt } = await mintStartOtp(bookingId, booking, now);
  const target = booking.status === "PARTNER_ACCEPTED" ? "OTP_GENERATED" : booking.status;
  await prisma.notification.create({
    data: {
      userId: booking.userId,
      title: "Your start code is ready",
      body: "Share this code with your partner in person when they arrive. Never share it in chat.",
      data: JSON.stringify({ bookingId }),
    },
  });
  void logBookingTransition({ bookingId, fromStatus: booking.status, toStatus: target, actorId: actorUserId, actorType: "USER", note: "Start OTP issued" });
  return { otp, expiresAt };
}

// --- Travel: GO TO JOB / ARRIVED (partner, time-window gated) ----------------

export async function markTravelling(bookingId: string, partnerUserId: string, now = new Date()) {
  const booking = await getBookingOrThrow(bookingId);
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId } });
  if (!partner || booking.partnerId !== partner.id) throw otpError("FORBIDDEN", "This job is not assigned to you.", 403);
  if (!["PARTNER_ACCEPTED", "OTP_GENERATED"].includes(booking.status)) {
    throw otpError("INVALID_STATUS", "Travel can start only for an upcoming accepted job.", 409);
  }
  const early = await getEarlyStartMinutes(booking.serviceType);
  if (!isWithinStartWindow(new Date(booking.scheduledAt), now, early)) {
    throw otpError("TOO_EARLY", "The go-to-job window has not opened yet. Do not start days early.", 409);
  }
  const notes = parseNotes(booking.notes);
  notes.trip = { ...(notes.trip ?? {}), phase: "TRAVELLING", travellingAt: now.toISOString() };
  await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
  void logBookingTransition({ bookingId, fromStatus: booking.status, toStatus: booking.status, actorId: partnerUserId, actorType: "PARTNER", note: "Partner travelling" });
  return { phase: "TRAVELLING" as TripPhase };
}

export async function markArrived(bookingId: string, partnerUserId: string, now = new Date()) {
  const booking = await getBookingOrThrow(bookingId);
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId } });
  if (!partner || booking.partnerId !== partner.id) throw otpError("FORBIDDEN", "This job is not assigned to you.", 403);
  if (!["PARTNER_ACCEPTED", "OTP_GENERATED"].includes(booking.status)) {
    throw otpError("INVALID_STATUS", "Arrival applies only to an upcoming accepted job.", 409);
  }
  const notes = parseNotes(booking.notes);
  notes.trip = { ...(notes.trip ?? {}), phase: "ARRIVED", arrivedAt: now.toISOString() };
  await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
  void logBookingTransition({ bookingId, fromStatus: booking.status, toStatus: booking.status, actorId: partnerUserId, actorType: "PARTNER", note: "Partner arrived" });

  // The user must GET the start code the moment the partner arrives — never
  // silently. Auto-issue unless a live code already exists (no rotation).
  if (startOtpAlive(notes, now)) {
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Your partner has arrived",
        body: "Your partner is at the location. Share your start code in person — open the booking to get a fresh one if needed.",
        data: JSON.stringify({ bookingId }),
      },
    });
  } else {
    const fresh = await getBookingOrThrow(bookingId);
    const { otp } = await mintStartOtp(bookingId, fresh, now);
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Your partner has arrived — start code inside",
        body: `Your partner is at the location. Your start code is ${otp}. Read it out in person; never share it in chat.`,
        data: JSON.stringify({ bookingId, type: "BOOKING_OTP" }),
      },
    });
    void logBookingTransition({ bookingId, fromStatus: fresh.status, toStatus: "OTP_GENERATED", actorId: null, actorType: "SYSTEM", note: "Start OTP auto-issued on arrival" });
  }
  return { phase: "ARRIVED" as TripPhase };
}

// --- START verify: partner enters the USER's code; backend starts timer ------

export async function verifyStartOtp(bookingId: string, partnerUserId: string, otp: string, now = new Date()) {
  if (!otp) throw otpError("INVALID_OTP", "Enter the start code.", 400);
  const booking = await getBookingOrThrow(bookingId);
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId } });
  if (!partner || booking.partnerId !== partner.id) throw otpError("FORBIDDEN", "This job is not assigned to you.", 403);
  if (booking.status === "IN_PROGRESS") return booking;
  if (booking.status !== "OTP_GENERATED") throw otpError("START_OTP_REQUIRED", "Request the start code first; jobs cannot start directly after accept.", 409);

  const early = await getEarlyStartMinutes(booking.serviceType);
  if (!isWithinStartWindow(new Date(booking.scheduledAt), now, early)) {
    throw otpError("TOO_EARLY", "This scheduled job cannot start before its time window.", 409);
  }

  const notes = parseNotes(booking.notes);
  const rec = notes.startOtp;
  if (!rec?.hash) throw otpError("START_OTP_REQUIRED", "No active start code. Ask the user to generate it.", 409);
  if (isExpired(rec.expiresAt, now)) throw otpError("OTP_EXPIRED", "Start code expired. Ask the user for a new one.", 410);
  if ((rec.attempts ?? 0) >= OTP_MAX_ATTEMPTS) throw otpError("OTP_LOCKED", "Too many wrong attempts. Ask the user for a new code.", 429);
  if (!verifyOtpHash(otp, rec.hash)) {
    rec.attempts = (rec.attempts ?? 0) + 1;
    await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
    void checkOtpAbuse(bookingId, "START", rec.attempts);
    throw otpError("INVALID_OTP", "Invalid start code. Try again.", 400);
  }

  assertTransition(booking.status, "IN_PROGRESS");
  rec.verifiedAt = now.toISOString();
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: "IN_PROGRESS", startedAt: now, otpVerifiedAt: now, notes: JSON.stringify(notes) },
  });
  void logBookingTransition({ bookingId, fromStatus: "OTP_GENERATED", toStatus: "IN_PROGRESS", actorId: partnerUserId, actorType: "PARTNER", note: "Start OTP verified; timer started" });
  return updated;
}

// --- COMPLETION request + OTP -------------------------------------------------

export async function requestCompletion(bookingId: string, partnerUserId: string, now = new Date()) {
  const booking = await getBookingOrThrow(bookingId);
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId } });
  if (!partner || booking.partnerId !== partner.id) throw otpError("FORBIDDEN", "This job is not assigned to you.", 403);
  if (booking.status === "COMPLETION_REQUESTED") return booking;
  if (booking.status !== "IN_PROGRESS") throw otpError("INVALID_STATUS", "Only an in-progress job can request completion.", 409);
  assertTransition("IN_PROGRESS", "COMPLETION_REQUESTED");
  const notes = parseNotes(booking.notes);
  notes.trip = { ...(notes.trip ?? {}), completionRequestedAt: now.toISOString() };
  const updated = await prisma.booking.update({ where: { id: bookingId }, data: { status: "COMPLETION_REQUESTED", notes: JSON.stringify(notes) } });
  void logBookingTransition({ bookingId, fromStatus: "IN_PROGRESS", toStatus: "COMPLETION_REQUESTED", actorId: partnerUserId, actorType: "PARTNER", note: "Completion requested" });

  // The user must GET the completion code the moment completion is requested.
  // Auto-issue unless a live code already exists (no rotation).
  const freshNotes = parseNotes(JSON.stringify({ ...notes }));
  if (completionOtpAlive(freshNotes, now)) {
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Partner requested completion",
        body: "Review the duration and confirm with your completion code. Open the booking to get a fresh one if needed.",
        data: JSON.stringify({ bookingId }),
      },
    });
  } else {
    const otp = generateOtp();
    freshNotes.completionOtp = {
      hash: hashOtp(otp),
      expiresAt: new Date(now.getTime() + COMPLETION_OTP_TTL_MIN * 60_000).toISOString(),
      attempts: 0,
      verifiedAt: null,
    };
    await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(freshNotes) } });
    await prisma.notification.create({
      data: {
        userId: booking.userId,
        title: "Partner requested completion — code inside",
        body: `Review the work, then read this code out in person: ${otp}. Never share it in chat.`,
        data: JSON.stringify({ bookingId, type: "BOOKING_COMPLETION_OTP" }),
      },
    });
    void logBookingTransition({ bookingId, fromStatus: "COMPLETION_REQUESTED", toStatus: "COMPLETION_REQUESTED", actorId: null, actorType: "SYSTEM", note: "Completion OTP auto-issued on request" });
  }
  return updated;
}

export async function issueCompletionOtp(bookingId: string, actorUserId: string, now = new Date()) {
  const booking = await getBookingOrThrow(bookingId);
  if (booking.userId !== actorUserId) throw otpError("FORBIDDEN", "Only the booking owner can view the completion code.", 403);
  if (booking.status !== "COMPLETION_REQUESTED") {
    throw otpError("INVALID_STATUS", "Completion code is available only after the partner requests completion.", 409);
  }
  const otp = generateOtp();
  const notes = parseNotes(booking.notes);
  notes.completionOtp = {
    hash: hashOtp(otp),
    expiresAt: new Date(now.getTime() + COMPLETION_OTP_TTL_MIN * 60_000).toISOString(),
    attempts: 0,
    verifiedAt: null,
  };
  await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
  void logBookingTransition({ bookingId, fromStatus: booking.status, toStatus: booking.status, actorId: actorUserId, actorType: "USER", note: "Completion OTP issued" });
  return { otp, expiresAt: notes.completionOtp.expiresAt };
}

export function assertCompletionOtpVerified(notes: WorkflowNotes): void {
  if (!notes.completionOtp?.verifiedAt) {
    throw otpError("COMPLETION_OTP_REQUIRED", "Completion code verification is required. Partners cannot complete directly.", 409);
  }
}

export async function verifyCompletionOtp(bookingId: string, partnerUserId: string, otp: string, now = new Date()) {
  if (!otp) throw otpError("INVALID_OTP", "Enter the completion code.", 400);
  const booking = await getBookingOrThrow(bookingId);
  const partner = await prisma.partner.findUnique({ where: { userId: partnerUserId } });
  if (!partner || booking.partnerId !== partner.id) throw otpError("FORBIDDEN", "This job is not assigned to you.", 403);
  if (booking.status === "COMPLETED") return booking;
  if (booking.status !== "COMPLETION_REQUESTED") {
    throw otpError("COMPLETION_OTP_REQUIRED", "Request completion first; jobs cannot complete directly from in-progress.", 409);
  }
  const notes = parseNotes(booking.notes);
  const rec = notes.completionOtp;
  if (!rec?.hash) throw otpError("COMPLETION_OTP_REQUIRED", "No active completion code. Ask the user to generate it.", 409);
  if (isExpired(rec.expiresAt, now)) throw otpError("OTP_EXPIRED", "Completion code expired. Ask the user for a new one.", 410);
  if ((rec.attempts ?? 0) >= OTP_MAX_ATTEMPTS) throw otpError("OTP_LOCKED", "Too many wrong attempts. Ask the user for a new code.", 429);
  if (!verifyOtpHash(otp, rec.hash)) {
    rec.attempts = (rec.attempts ?? 0) + 1;
    await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
    void checkOtpAbuse(bookingId, "COMPLETION", rec.attempts);
    throw otpError("INVALID_OTP", "Invalid completion code. Try again.", 400);
  }
  rec.verifiedAt = now.toISOString();
  await prisma.booking.update({ where: { id: bookingId }, data: { notes: JSON.stringify(notes) } });
  void logBookingTransition({ bookingId, fromStatus: booking.status, toStatus: booking.status, actorId: partnerUserId, actorType: "PARTNER", note: "Completion OTP verified" });
  return { verified: true as const };
}

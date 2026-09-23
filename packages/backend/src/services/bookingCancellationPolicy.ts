export const BOOKING_CANCELLATION_CUTOFF_MS = 60 * 60 * 1000
export const BOOKING_CANCELLATION_CUTOFF_MESSAGE =
  "Cancellation is no longer available. Bookings cannot be cancelled within 1 hour of the scheduled start time."

export class CancellationCutoffError extends Error {
  readonly code = "CANCELLATION_CUTOFF_PASSED"

  constructor() {
    super(BOOKING_CANCELLATION_CUTOFF_MESSAGE)
    this.name = "CancellationCutoffError"
  }
}

export function getBookingCancellationDeadline(scheduledAt: Date): Date {
  return new Date(scheduledAt.getTime() - BOOKING_CANCELLATION_CUTOFF_MS)
}

export function isBookingCancellationAllowed(scheduledAt: Date, serverNow = new Date()): boolean {
  return serverNow.getTime() < getBookingCancellationDeadline(scheduledAt).getTime()
}

export function assertBookingCancellationAllowed(
  actor: "USER" | "PARTNER" | "SYSTEM",
  scheduledAt: Date,
  serverNow = new Date()
): void {
  if (actor !== "SYSTEM" && !isBookingCancellationAllowed(scheduledAt, serverNow)) {
    throw new CancellationCutoffError()
  }
}

export function getBookingCancellationState(
  scheduledAt: Date,
  status: string,
  serverNow = new Date()
): { cancellationAllowed: boolean; cancellationDeadlineAt: string; cancellationServerTime: string } {
  const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "REFUND_INITIATED", "REFUND_COMPLETED"]);
  return {
    cancellationAllowed:
      !terminalStatuses.has(status) && isBookingCancellationAllowed(scheduledAt, serverNow),
    cancellationDeadlineAt: getBookingCancellationDeadline(scheduledAt).toISOString(),
    cancellationServerTime: serverNow.toISOString(),
  };
}

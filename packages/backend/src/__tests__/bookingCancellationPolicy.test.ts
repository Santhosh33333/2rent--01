import { describe, expect, it } from "vitest";
import {
  BOOKING_CANCELLATION_CUTOFF_MS,
  assertBookingCancellationAllowed,
  CancellationCutoffError,
  getBookingCancellationDeadline,
  isBookingCancellationAllowed,
} from "../services/bookingCancellationPolicy";

describe("one-hour booking cancellation cutoff", () => {
  const scheduledAt = new Date("2030-06-01T18:00:00.000Z");
  const deadline = getBookingCancellationDeadline(scheduledAt);

  it("calculates the deadline one hour before the scheduled start", () => {
    expect(deadline.toISOString()).toBe("2030-06-01T17:00:00.000Z");
    expect(scheduledAt.getTime() - deadline.getTime()).toBe(BOOKING_CANCELLATION_CUTOFF_MS);
  });

  it("allows cancellation strictly before the deadline", () => {
    expect(isBookingCancellationAllowed(scheduledAt, new Date(deadline.getTime() - 1))).toBe(true);
  });

  it("blocks cancellation at the deadline and after it", () => {
    expect(isBookingCancellationAllowed(scheduledAt, deadline)).toBe(false);
    expect(isBookingCancellationAllowed(scheduledAt, new Date(deadline.getTime() + 1))).toBe(false);
  });

  it.each(["USER", "PARTNER"] as const)("enforces the same server-time cutoff for %s cancellations", (actor) => {
    expect(() => assertBookingCancellationAllowed(actor, scheduledAt, new Date(deadline.getTime() - 1))).not.toThrow();
    expect(() => assertBookingCancellationAllowed(actor, scheduledAt, deadline)).toThrow(CancellationCutoffError);
    expect(() => assertBookingCancellationAllowed(actor, scheduledAt, new Date(deadline.getTime() + 60_000))).toThrow(CancellationCutoffError);
  });

  it("does not apply the user cutoff to system timeout cancellation", () => {
    expect(() => assertBookingCancellationAllowed("SYSTEM", scheduledAt, deadline)).not.toThrow();
  });
});

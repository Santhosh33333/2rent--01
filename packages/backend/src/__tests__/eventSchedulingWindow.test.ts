// Rules that must hold regardless of client state, so they are asserted at the
// policy layer and covered here directly.
import { describe, it, expect } from 'vitest';
import {
  assertEventWithinHours,
  EventWindowError,
  getEventMaxEnd,
  isEventEndWithinHours,
} from '../services/eventSchedulingWindow.js';
import {
  getBookingCancellationDeadline,
  isBookingCancellationAllowed,
} from '../services/bookingCancellationPolicy.js';

describe('Event scheduling window: no event may run past 10:00 PM', () => {
  it('permits an event ending exactly at 22:00', () => {
    const start = new Date('2026-06-10T18:00:00.000Z');
    const end = new Date('2026-06-10T22:00:00.000Z');
    expect(isEventEndWithinHours(start, end)).toBe(true);
  });

  it('rejects an event ending at 22:01', () => {
    const start = new Date('2026-06-10T18:00:00.000Z');
    const end = new Date('2026-06-10T22:01:00.000Z');
    expect(isEventEndWithinHours(start, end)).toBe(false);
  });

  it('rejects a long event that spans past 22:00', () => {
    const start = new Date('2026-06-10T20:00:00.000Z');
    const end = new Date('2026-06-10T23:30:00.000Z');
    expect(isEventEndWithinHours(start, end)).toBe(false);
  });

  it('rejects end before start regardless of the hour', () => {
    const start = new Date('2026-06-10T19:00:00.000Z');
    const end = new Date('2026-06-10T18:00:00.000Z');
    expect(isEventEndWithinHours(start, end)).toBe(false);
  });

  it('max end is 22:00 on the start date, not pushed to the next day', () => {
    const start = new Date('2026-06-10T18:00:00.000Z');
    expect(getEventMaxEnd(start).toISOString()).toBe('2026-06-10T22:00:00.000Z');
  });

  it('a late start cannot borrow the next day to pass the cap', () => {
    const start = new Date('2026-06-10T23:00:00.000Z');
    const end = new Date('2026-06-11T01:00:00.000Z');
    expect(isEventEndWithinHours(start, end)).toBe(false);
  });

  it('a missing end time is not a violation', () => {
    const start = new Date('2026-06-10T18:00:00.000Z');
    expect(() => assertEventWithinHours(start, null)).not.toThrow();
    expect(() => assertEventWithinHours(start, undefined)).not.toThrow();
  });

  it('throws a coded error so the API can return 400 not 500', () => {
    const start = new Date('2026-06-10T18:00:00.000Z');
    const end = new Date('2026-06-10T23:00:00.000Z');
    try {
      assertEventWithinHours(start, end);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(EventWindowError);
      expect((e as EventWindowError).code).toBe('EVENT_AFTER_HOURS');
    }
  });

  it('uses a UTC boundary so the rule does not move with the host timezone', () => {
    // 22:00 UTC must stay 22:00 UTC, not 03:30 next day under UTC+5:30.
    const start = new Date('2026-06-10T12:00:00.000Z');
    expect(getEventMaxEnd(start).getUTCHours()).toBe(22);
  });
});

describe('Booking cancellation cutoff (server time is authoritative)', () => {
  it('a 6:00 PM booking can be cancelled before 5:00 PM', () => {
    const scheduled = new Date('2026-06-10T18:00:00.000Z');
    expect(getBookingCancellationDeadline(scheduled).toISOString()).toBe('2026-06-10T17:00:00.000Z');
    expect(isBookingCancellationAllowed(scheduled, new Date('2026-06-10T16:59:00.000Z'))).toBe(true);
  });

  it('the same booking is locked at exactly 5:00 PM', () => {
    const scheduled = new Date('2026-06-10T18:00:00.000Z');
    expect(isBookingCancellationAllowed(scheduled, new Date('2026-06-10T17:00:00.000Z'))).toBe(false);
  });

  it('an evening booking is locked after the cutoff', () => {
    const scheduled = new Date('2026-06-10T21:00:00.000Z');
    expect(isBookingCancellationAllowed(scheduled, new Date('2026-06-10T20:00:00.000Z'))).toBe(false);
  });

  it('a morning booking is still cancellable well before it starts', () => {
    const scheduled = new Date('2026-06-10T09:00:00.000Z');
    expect(isBookingCancellationAllowed(scheduled, new Date('2026-06-10T07:00:00.000Z'))).toBe(true);
  });
});

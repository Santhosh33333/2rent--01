// Rules that must hold regardless of client state, so they are asserted at the
// policy layer and covered here directly.
import { describe, it, expect } from 'vitest';
import {
  assertEventWithinHours,
  defaultEventEnd,
  EventStartWindowError,
  EventWindowError,
  getEventMaxEnd,
  getEventMinStart,
  isEventEndWithinHours,
  isEventStartWithinDay,
  isEventStartWithinHours,
  resolveEventTimeZone,
} from '../services/eventSchedulingWindow.js';
import {
  getBookingCancellationDeadline,
  isBookingCancellationAllowed,
} from '../services/bookingCancellationPolicy.js';

const IST = 'Asia/Kolkata'; // UTC+5:30, no DST

/** 10:30 AM IST on the given day, as a real instant. */
const istMorning = (day: string) => new Date(`${day}T05:00:00.000Z`);

describe('Event scheduling window: local 6 AM to 10 PM', () => {
  it('permits an event ending exactly at 10 PM local', () => {
    const start = istMorning('2026-06-10'); // 10:30 AM IST
    const end = new Date('2026-06-10T16:30:00.000Z'); // 22:00 IST
    expect(isEventEndWithinHours(start, end, IST)).toBe(true);
  });

  it('rejects an event ending at 10:01 PM local', () => {
    const start = istMorning('2026-06-10');
    const end = new Date('2026-06-10T16:31:00.000Z');
    expect(isEventEndWithinHours(start, end, IST)).toBe(false);
  });

  it('rejects an event starting before 6 AM local', () => {
    // 5:30 AM IST
    const start = new Date('2026-06-10T00:00:00.000Z');
    expect(isEventStartWithinHours(start, IST)).toBe(false);
  });

  it('permits an event starting exactly at 6 AM local', () => {
    // 6:00 AM IST is 00:30 UTC
    const start = new Date('2026-06-10T00:30:00.000Z');
    expect(isEventStartWithinHours(start, IST)).toBe(true);
  });

  it('rejects a start after 10 PM local with a message about the start, not the end', () => {
    // 11 PM IST. The old wording told the organizer the event "has to finish by
    // 10:00 PM" for an event they had not started yet.
    const start = new Date('2026-06-10T17:30:00.000Z'); // 23:00 IST
    expect(isEventStartWithinHours(start, IST)).toBe(true); // after 6 AM, so that check passes
    expect(isEventStartWithinDay(start, IST)).toBe(false);
    try {
      assertEventWithinHours(start, new Date('2026-06-10T19:00:00.000Z'), IST);
      throw new Error('expected throw');
    } catch (e) {
      expect((e as EventStartWindowError).message).toMatch(/cannot start after 10:00 PM/);
    }
  });

  it('permits an ordinary 9 PM showtime that the old UTC cap rejected', () => {
    // 9:00 PM IST -> 10:00 PM IST. The 22:00 UTC rule killed this outright.
    const start = new Date('2026-06-10T15:30:00.000Z');
    const end = new Date('2026-06-10T16:30:00.000Z');
    expect(isEventEndWithinHours(start, end, IST)).toBe(true);
    expect(isEventStartWithinHours(start, IST)).toBe(true);
  });

  it('rejects a 2 AM event running until half past three, which the UTC cap allowed', () => {
    const start = new Date('2026-06-09T20:30:00.000Z'); // 02:00 IST next day
    const end = new Date('2026-06-09T22:00:00.000Z'); // 03:30 IST
    expect(isEventStartWithinHours(start, IST)).toBe(false);
  });

  it('rejects an event that crosses midnight local', () => {
    const start = new Date('2026-06-10T14:00:00.000Z'); // 19:30 IST
    const end = new Date('2026-06-10T18:00:00.000Z'); // 23:30 IST
    expect(isEventEndWithinHours(start, end, IST)).toBe(false);
  });

  it('rejects end before start regardless of the hour', () => {
    const start = new Date('2026-06-10T08:00:00.000Z');
    const end = new Date('2026-06-10T07:00:00.000Z');
    expect(isEventEndWithinHours(start, end, IST)).toBe(false);
  });

  it('max end is 10 PM local on the start date, not pushed to the next day', () => {
    const start = istMorning('2026-06-10');
    expect(getEventMaxEnd(start, IST).toISOString()).toBe('2026-06-10T16:30:00.000Z');
    expect(getEventMinStart(start, IST).toISOString()).toBe('2026-06-10T00:30:00.000Z');
  });

  it('keeps the local boundary local across a half-hour offset zone', () => {
    // 10 PM in Kolkata is 16:30 UTC, never 22:00 UTC.
    const start = istMorning('2026-06-10');
    expect(getEventMaxEnd(start, IST).getUTCHours()).toBe(16);
  });

  it('defaults to Asia/Kolkata when no timezone is supplied', () => {
    expect(resolveEventTimeZone(undefined)).toBe('Asia/Kolkata');
    expect(resolveEventTimeZone('')).toBe('Asia/Kolkata');
    expect(resolveEventTimeZone('Not/AZone')).toBe('Asia/Kolkata');
    expect(resolveEventTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('a missing end time is not a violation', () => {
    const start = istMorning('2026-06-10');
    expect(() => assertEventWithinHours(start, null, IST)).not.toThrow();
    expect(() => assertEventWithinHours(start, undefined, IST)).not.toThrow();
  });

  it('throws a coded error so the API can return 400 not 500', () => {
    const start = istMorning('2026-06-10');
    const end = new Date('2026-06-10T17:00:00.000Z'); // 22:30 IST
    try {
      assertEventWithinHours(start, end, IST);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(EventWindowError);
      expect((e as EventWindowError).code).toBe('EVENT_AFTER_HOURS');
    }
  });

  it('throws a distinct coded error for a start before 6 AM', () => {
    const start = new Date('2026-06-10T00:00:00.000Z'); // 05:30 IST
    try {
      assertEventWithinHours(start, new Date('2026-06-10T03:00:00.000Z'), IST);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(EventStartWindowError);
      expect((e as EventStartWindowError).code).toBe('EVENT_BEFORE_HOURS');
    }
  });

  it('clamps the default end to 10 PM instead of rejecting a 9 PM showtime', () => {
    // 9 PM IST with no end time: 2h default would land on 11 PM.
    const start = new Date('2026-06-10T15:30:00.000Z');
    const end = defaultEventEnd(start, IST);
    expect(end.toISOString()).toBe('2026-06-10T16:30:00.000Z');
    expect(isEventEndWithinHours(start, end, IST)).toBe(true);
  });

  it('keeps a 2 hour default end when it already fits', () => {
    const start = istMorning('2026-06-10');
    expect(defaultEventEnd(start, IST).toISOString()).toBe('2026-06-10T07:00:00.000Z');
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

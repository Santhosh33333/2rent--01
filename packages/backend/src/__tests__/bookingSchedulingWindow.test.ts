import { describe, it, expect } from 'vitest';
import {
  assertBookingStartWithinHours,
  BookingWindowError,
  getBookingMaxStart,
  getBookingMinStart,
  isBookingStartWithinHours,
} from '../services/bookingSchedulingWindow.js';

const IST = 'Asia/Kolkata';

/**
 * Wall-clock IST -> instant. IST is UTC+5:30, so local 2026-06-10 09:00 is
 * 2026-06-10T03:30Z. Built by shifting the UTC fields, which keeps the
 * calendar day readable in the test names.
 */
function istHour(day: string, hour: number, minute = 0): Date {
  return new Date(Date.UTC(2026, 5, Number(day), hour, minute) - 330 * 60 * 1000);
}

describe('Partner booking window: local 4 AM to 10 PM', () => {
  it('permits a booking at 4:00 AM local', () => {
    expect(isBookingStartWithinHours(istHour('10', 4), IST)).toBe(true);
  });

  it('rejects a booking at 3:59 AM local', () => {
    expect(isBookingStartWithinHours(istHour('10', 3, 59), IST)).toBe(false);
  });

  it('permits an ordinary 9:30 PM booking', () => {
    expect(isBookingStartWithinHours(istHour('10', 21, 30), IST)).toBe(true);
  });

  it('rejects a booking at 10:01 PM local', () => {
    expect(isBookingStartWithinHours(istHour('10', 22, 1), IST)).toBe(false);
  });

  it('rejects a booking at 11 PM local that the old UTC rule allowed', () => {
    // 11 PM IST is 17:30 UTC, comfortably inside the removed 22:00 UTC cap.
    expect(isBookingStartWithinHours(istHour('10', 23), IST)).toBe(false);
  });

  it('rejects a 2 AM booking local', () => {
    expect(isBookingStartWithinHours(istHour('10', 2), IST)).toBe(false);
  });

  it('bounds land on the right instants in a half-hour zone', () => {
    // 4 AM IST = 22:30 UTC the previous day; 10 PM IST = 16:30 UTC.
    expect(getBookingMinStart(istHour('10', 12), IST).toISOString()).toBe(
      '2026-06-09T22:30:00.000Z',
    );
    expect(getBookingMaxStart(istHour('10', 12), IST).toISOString()).toBe(
      '2026-06-10T16:30:00.000Z',
    );
  });

  it('defaults to Asia/Kolkata when the client sends no timezone', () => {
    expect(isBookingStartWithinHours(istHour('10', 23), undefined)).toBe(false);
    expect(isBookingStartWithinHours(istHour('10', 23), 'Not/AZone')).toBe(false);
  });

  it('throws a coded early error so the API returns 400 not 500', () => {
    try {
      assertBookingStartWithinHours(istHour('10', 3), IST);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BookingWindowError);
      expect((e as BookingWindowError).code).toBe('BOOKING_BEFORE_HOURS');
      expect((e as BookingWindowError).message).toMatch(/4:00 AM/);
    }
  });

  it('throws a coded late error', () => {
    try {
      assertBookingStartWithinHours(istHour('10', 23), IST);
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(BookingWindowError);
      expect((e as BookingWindowError).code).toBe('BOOKING_AFTER_HOURS');
      expect((e as BookingWindowError).message).toMatch(/10:00 PM/);
    }
  });
});
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_APP_TIMEZONE,
  instantAtLocalHourOnDayOf,
  isSameLocalDay,
  localDayKey,
  localParts,
  resolveTimeZone,
} from '../services/localTime.js';

const IST = 'Asia/Kolkata';

describe('Local day boundaries (the cinema day starts at midnight local)', () => {
  it('uses Asia/Kolkata by default and rejects junk zones', () => {
    expect(resolveTimeZone(undefined)).toBe(DEFAULT_APP_TIMEZONE);
    expect(resolveTimeZone('  ')).toBe('Asia/Kolkata');
    expect(resolveTimeZone('Not/AZone')).toBe('Asia/Kolkata');
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimeZone('UTC')).toBe('UTC');
  });

  it('reads 2 AM IST as the same day even though UTC has already rolled over', () => {
    // 2026-09-30T20:00Z is 01:30 on 1 Oct in Kolkata. A UTC-based "today" would
    // call this 30 September and show the wrong films for the morning.
    const instant = new Date('2026-09-30T20:00:00.000Z');
    expect(localDayKey(instant, IST)).toBe('2026-10-01');
    expect(localDayKey(instant, 'UTC')).toBe('2026-09-30');
  });

  it('rolls the day at midnight IST, not at 5:30 AM', () => {
    const justAfterMidnight = new Date('2026-09-30T18:31:00.000Z'); // 00:01 IST 1 Oct
    const justBeforeMidnight = new Date('2026-09-30T18:29:00.000Z'); // 23:59 IST 30 Sep
    expect(localDayKey(justBeforeMidnight, IST)).toBe('2026-09-30');
    expect(localDayKey(justAfterMidnight, IST)).toBe('2026-10-01');
  });

  it('reports the local wall clock hour', () => {
    const instant = new Date('2026-09-30T18:30:00.000Z'); // exactly midnight IST
    expect(localParts(instant, IST).hour).toBe(0);
    expect(localParts(new Date('2026-09-30T15:30:00.000Z'), IST).hour).toBe(21);
  });

  it('treats midnight as hour 0 even where ICU reports 24', () => {
    expect(localParts(new Date('2026-09-30T18:30:00.000Z'), IST).hour).toBeLessThan(24);
  });

  it('compares calendar days in the given zone', () => {
    const afterMidnightIst = new Date('2026-09-30T19:00:00.000Z'); // 00:30 IST 1 Oct
    const eveningIst = new Date('2026-09-30T13:00:00.000Z'); // 18:30 IST 30 Sep
    const sameDayIst = new Date('2026-09-30T20:00:00.000Z'); // 01:30 IST 1 Oct
    expect(isSameLocalDay(afterMidnightIst, eveningIst, IST)).toBe(false);
    expect(isSameLocalDay(afterMidnightIst, sameDayIst, IST)).toBe(true);
    // In UTC all three are still 30 September, which is the mix-up being fixed.
    expect(isSameLocalDay(afterMidnightIst, eveningIst, 'UTC')).toBe(true);
  });

  it('solves for a local wall-clock instant across the half-hour offset', () => {
    // 6 AM IST is 00:30 UTC the same day.
    expect(instantAtLocalHourOnDayOf(new Date('2026-09-30T10:00:00.000Z'), 6, 0, IST).toISOString())
      .toBe('2026-09-30T00:30:00.000Z');
    // 10 PM IST is 16:30 UTC the same day.
    expect(instantAtLocalHourOnDayOf(new Date('2026-09-30T10:00:00.000Z'), 22, 0, IST).toISOString())
      .toBe('2026-09-30T16:30:00.000Z');
  });
});
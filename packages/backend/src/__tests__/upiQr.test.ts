import { describe, it, expect } from 'vitest';

import {
  buildHourlyQr,
  buildReference,
  buildUpiUri,
  classifyUpiInput,
  hourBucket,
  isVpa,
  nextHourBoundary,
  normalizePhone,
  safeReferenceLength,
} from '../services/upiQr';

const VPA = 'nabri@okhdfcbank';
const WHEN = new Date('2026-09-26T14:37:12.000Z');

describe('hourly QR rotation', () => {
  it('buckets by UTC hour', () => {
    expect(hourBucket(new Date('2026-09-26T14:00:00.000Z'))).toBe('2026092614');
    expect(hourBucket(new Date('2026-09-26T14:59:59.999Z'))).toBe('2026092614');
    expect(hourBucket(new Date('2026-09-26T15:00:00.000Z'))).toBe('2026092615');
  });

  it('expires at the next hour boundary', () => {
    expect(nextHourBoundary(WHEN).toISOString()).toBe('2026-09-26T15:00:00.000Z');
  });

  it('reports the seconds left in the current hour', () => {
    const qr = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: WHEN });
    // 14:37:12 -> 15:00:00
    expect(qr.expiresInSeconds).toBe(22 * 60 + 48);
  });

  it('issues a different reference in every hour', () => {
    const first = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: new Date('2026-09-26T14:05:00Z') });
    const sameHour = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: new Date('2026-09-26T14:55:00Z') });
    const nextHour = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: new Date('2026-09-26T15:05:00Z') });

    expect(first.reference).toBe(sameHour.reference);
    expect(nextHour.reference).not.toBe(first.reference);
  });

  it('separates different bookings within the same hour', () => {
    const a = buildReference('booking-1', WHEN);
    const b = buildReference('booking-2', WHEN);
    expect(a).not.toBe(b);
  });

  it('keeps the reference short enough for UPI apps', () => {
    const reference = buildReference('a'.repeat(80), WHEN);
    expect(reference.length).toBeLessThanOrEqual(safeReferenceLength);
    expect(reference.length).toBeGreaterThan(0);
  });

  it('survives a hostile scope without emitting separators', () => {
    const reference = buildReference('../../etc/passwd', WHEN);
    expect(reference).toMatch(/^[A-Za-z0-9]+$/);
  });
});

describe('UPI intent URI', () => {
  it('carries the payee, amount and the hourly reference', () => {
    const uri = buildUpiUri({
      payeeVpa: VPA,
      payeeName: 'Nabri Services',
      amount: 499.5,
      note: 'Nabri booking 1A2B3C4D',
      reference: 'N1A2B3C4D2026092614',
    });

    expect(uri.startsWith('upi://pay?')).toBe(true);
    const params = new URLSearchParams(uri.slice('upi://pay?'.length));
    expect(params.get('pa')).toBe(VPA);
    expect(params.get('pn')).toBe('Nabri Services');
    expect(params.get('am')).toBe('499.50');
    expect(params.get('cu')).toBe('INR');
    expect(params.get('tr')).toBe('N1A2B3C4D2026092614');
  });

  it('encodes spaces as %20, not +, because UPI apps mis-parse +', () => {
    const uri = buildUpiUri({ payeeVpa: VPA, payeeName: 'Nabri Private Limited', reference: 'REF1' });
    expect(uri).not.toContain('+');
    expect(uri).toContain('%20');
  });

  it('omits the amount when it is unknown rather than sending zero', () => {
    const uri = buildUpiUri({ payeeVpa: VPA, reference: 'REF1', amount: null });
    expect(uri).not.toContain('am=');
  });

  it('changes the encoded payload when the hour changes', () => {
    const a = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: new Date('2026-09-26T14:05:00Z') });
    const b = buildHourlyQr({ payeeVpa: VPA, scope: 'booking-1', at: new Date('2026-09-26T15:05:00Z') });
    expect(a.upiUri).not.toBe(b.upiUri);
  });
});

describe('UPI / phone input classification', () => {
  it('accepts well-formed VPA handles', () => {
    expect(isVpa('name@okbank')).toBe(true);
    expect(isVpa('first.last@paytm')).toBe(true);
    expect(isVpa('bad')).toBe(false);
    expect(isVpa('a@b')).toBe(false);
    expect(isVpa('')).toBe(false);
  });

  it('normalises the phone formats customers actually type', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('09876543210')).toBe('9876543210');
    expect(normalizePhone('(98765) 43210')).toBe('9876543210');
    // Indian mobiles start 6-9; and 10 digits is the real limit.
    expect(normalizePhone('1234567890')).toBeNull();
    expect(normalizePhone('98765')).toBeNull();
  });

  it('tells a VPA apart from a phone number', () => {
    expect(classifyUpiInput('Nabri@okhdfcbank')).toEqual({ kind: 'VPA', value: 'nabri@okhdfcbank' });
    expect(classifyUpiInput('9876543210')).toEqual({ kind: 'PHONE', value: '9876543210' });
    expect(classifyUpiInput('not-a-upi')).toEqual({ kind: 'INVALID', value: 'not-a-upi' });
    expect(classifyUpiInput('')).toEqual({ kind: 'INVALID', value: '' });
  });
});

import { describe, it, expect } from 'vitest';

import {
  SUPPORTED_PAYMENT_METHODS,
  bookingStatusFor,
  paymentStatusFor,
  resolvePaymentMethod,
} from '../services/paymentMethodPolicy';

describe('payment method policy - UPI and cash only', () => {
  it('accepts the two supported methods', () => {
    expect(resolvePaymentMethod('UPI_MANUAL')).toBe('UPI_MANUAL');
    expect(resolvePaymentMethod('CASH')).toBe('CASH');
  });

  it('maps a legacy ONLINE request to UPI so old APKs are not stranded', () => {
    expect(resolvePaymentMethod('ONLINE')).toBe('UPI_MANUAL');
  });

  it('rejects anything else', () => {
    for (const bad of ['CRYPTO', 'NETBANKING', 'online', '', null, undefined, 42, {}]) {
      expect(resolvePaymentMethod(bad)).toBeNull();
    }
  });

  it('never produces an unpayable gateway state', () => {
    for (const requested of ['CASH', 'UPI_MANUAL', 'ONLINE']) {
      const method = resolvePaymentMethod(requested);
      expect(method).not.toBeNull();
      expect(['PENDING_CASH', 'VERIFICATION_PENDING']).toContain(paymentStatusFor(method!));
    }
  });

  it('advances the booking for cash but not for UPI', () => {
    // Cash goes straight to OTP_GENERATED; UPI must leave the booking status
    // alone so the service handshake is not skipped while payment is pending.
    expect(bookingStatusFor('CASH')).toBe('OTP_GENERATED');
    expect(bookingStatusFor('UPI_MANUAL')).toBeUndefined();
  });

  it('advertises only UPI and cash to clients', () => {
    expect(SUPPORTED_PAYMENT_METHODS).toEqual(['UPI_MANUAL', 'CASH']);
  });
});

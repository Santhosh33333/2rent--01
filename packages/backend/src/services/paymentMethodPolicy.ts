/**
 * Payment-method rules for bookings.
 *
 * Online payments are UPI-only: the customer pays to the Nabri UPI ID and
 * submits a reference number that an admin verifies against the bank statement.
 * The old Razorpay card/UPI auto-pay gateway is retired, so no booking may end
 * up in a gateway-driven state (PAYMENT_PENDING) that nothing can complete.
 *
 * Kept as a pure module so the rules are unit-testable without booting the
 * database or environment validation.
 */

export type SupportedPaymentMethod = 'CASH' | 'UPI_MANUAL';

/** Methods a brand-new client is allowed to request. */
export const SUPPORTED_PAYMENT_METHODS: SupportedPaymentMethod[] = ['UPI_MANUAL', 'CASH'];

/**
 * Normalise a requested payment method.
 *
 * 'ONLINE' is still accepted because customers on an already-installed APK can
 * send it; it is mapped to UPI so an in-flight booking is never stranded.
 * Anything else returns null and must be rejected.
 */
export function resolvePaymentMethod(requested: unknown): SupportedPaymentMethod | null {
  if (requested === 'CASH' || requested === 'UPI_MANUAL') return requested;
  if (requested === 'ONLINE') return 'UPI_MANUAL';
  return null;
}

/** Payment status a freshly selected method puts the booking into. */
export function paymentStatusFor(method: SupportedPaymentMethod): 'PENDING_CASH' | 'VERIFICATION_PENDING' {
  return method === 'CASH' ? 'PENDING_CASH' : 'VERIFICATION_PENDING';
}

/**
 * Booking status transition for a selected method.
 *
 * Cash advances the booking to OTP_GENERATED. UPI must not touch the booking
 * status, otherwise the OTP/service handshake would be skipped while the
 * payment is still awaiting verification.
 */
export function bookingStatusFor(method: SupportedPaymentMethod): 'OTP_GENERATED' | undefined {
  return method === 'CASH' ? 'OTP_GENERATED' : undefined;
}

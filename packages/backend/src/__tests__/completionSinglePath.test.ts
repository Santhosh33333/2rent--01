import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the consolidation of the duplicated booking-completion handlers.
 *
 * There used to be two independent implementations of the same money-moving
 * operation: bookingController.completeBooking (POST /api/bookings/:id/complete,
 * mounted behind idempotencyMiddleware) and partnerController.completeBooking
 * (POST /api/partner/bookings/:id/complete, not mounted behind it). They had
 * drifted -- the second settled through a raw prisma.$transaction instead of
 * moneyTransaction, recorded no status history, and was the only one of the two
 * that put the settlement figures (refund, overage) on the response, which is
 * why it existed at all.
 *
 * These assertions are deliberately structural rather than behavioural: the
 * handler is a large money-handling function with no integration harness, and
 * the regressions worth preventing here are "a second copy reappears" and
 * "the partner route drifts off the canonical handler again".
 */
const ROUTES = readFileSync(join(__dirname, '../routes/partnerRoutes.ts'), 'utf8');
const PARTNER_CTRL = readFileSync(join(__dirname, '../controllers/partnerController.ts'), 'utf8');
const BOOKING_CTRL = readFileSync(join(__dirname, '../controllers/bookingController.ts'), 'utf8');

describe('booking completion is not duplicated', () => {
  it('exposes exactly one completeBooking implementation', () => {
    const inBooking = /^export async function completeBooking/m.test(BOOKING_CTRL);
    const inPartner = /^export async function completeBooking/m.test(PARTNER_CTRL);
    expect(inBooking).toBe(true);
    expect(inPartner).toBe(false);
  });

  it('routes the partner completion endpoint at the canonical handler', () => {
    // Every other partner workflow route in this file already delegates to
    // bookingController; completion had been the exception. Comments are
    // stripped first because the route carries a long comment explaining the
    // consolidation that itself names the handler it replaced.
    const code = ROUTES.replace(/^\s*\/\/.*$/gm, '');
    const start = code.indexOf('"/bookings/:id/complete"');
    expect(start).toBeGreaterThan(-1);
    const block = code.slice(start, start + 2000);
    expect(block).toMatch(/bookingController\.completeBooking/);
    expect(code).not.toMatch(/partnerController\.completeBooking/);
  });

  it('keeps idempotency protection on the partner completion route', () => {
    // /api/bookings is mounted behind idempotencyMiddleware in app.ts; the
    // partner mount is not, so the route has to carry it itself now.
    const code = ROUTES.replace(/^\s*\/\/.*$/gm, '');
    const start = code.indexOf('"/bookings/:id/complete"');
    const block = code.slice(start, start + 2000);
    expect(block).toContain('idempotencyMiddleware');
  });

  it('settles through moneyTransaction, not a raw prisma transaction', () => {
    const start = BOOKING_CTRL.indexOf('export async function completeBooking');
    const end = BOOKING_CTRL.indexOf('\nexport ', start + 10);
    const body = BOOKING_CTRL.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('moneyTransaction');
    expect(body).not.toMatch(/prisma\.\$transaction/);
  });

  it('returns the settlement figures the client needs, including overage', () => {
    // refundAmount / extraDebited / unpaidOverage came from the deleted
    // duplicate. Without them on this response the partner cannot tell the user
    // that extra time was billed, and no automatic later settlement happens.
    const start = BOOKING_CTRL.indexOf('export async function completeBooking');
    const end = BOOKING_CTRL.indexOf('\nexport ', start + 10);
    const body = BOOKING_CTRL.slice(start, end === -1 ? undefined : end);
    for (const field of ['finalAmount', 'refundAmount', 'platformFee', 'partnerEarning', 'extraDebited', 'unpaidOverage']) {
      expect(body).toContain(`responsePayload.${field} =`);
    }
  });

  it('still records the status transition and the audit log', () => {
    const start = BOOKING_CTRL.indexOf('export async function completeBooking');
    const end = BOOKING_CTRL.indexOf('\nexport ', start + 10);
    const body = BOOKING_CTRL.slice(start, end === -1 ? undefined : end);
    expect(body).toContain('logBookingTransition');
    expect(body).toContain('auditLog.create');
  });
});

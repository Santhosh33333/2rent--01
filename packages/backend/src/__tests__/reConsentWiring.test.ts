import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The re-consent banner tells users "Booking, chat and calling stay switched
 * off". That promise is enforced by middleware, and the middleware existed while
 * nothing called it, so the banner was making a commitment the server did not
 * keep.
 *
 * Asserted structurally against the route files for the same reason as
 * roleAccess / protectedRootAccount: importing the routers would pull in the
 * whole service graph. The important part is that this is a wiring test, not a
 * unit test, because the failure mode being guarded is "the function exists but
 * nobody calls it".
 */
const routesDir = join(__dirname, '..', 'routes');

function read(name: string): string {
  return readFileSync(join(routesDir, name), 'utf8');
}

function routeBlock(src: string, pattern: RegExp): string {
  const start = src.search(pattern);
  expect(start, `route not found for ${pattern}`).toBeGreaterThan(-1);
  // A route body runs to the next router.* call or a blank-line block end.
  const rest = src.slice(start + 1);
  const next = rest.search(/\nrouter\.(get|post|patch|put|delete|use)\(/);
  return rest.slice(0, next === -1 ? undefined : next);
}

describe('re-consent gate wiring', () => {
  it('blocks starting a new conversation once the grace period has lapsed', () => {
    const block = routeBlock(read('messageRoutes.ts'), /router\.post\(\s*\n\s*"\/",/);
    expect(block).toContain('requireReConsent()');
  });

  it('blocks placing a new booking', () => {
    const block = routeBlock(read('bookingRoutes.ts'), /router\.post\(\s*\n\s*"\/",/);
    expect(block).toContain('requireReConsent()');
  });

  it('blocks ringing a new call', () => {
    const block = routeBlock(read('callRoutes.ts'), /router\.post\(\s*\n\s*"\/",/);
    expect(block).toContain('requireReConsent()');
  });

  // The counterpart to the three above. A gate that is applied too widely is
  // just as broken as one that is missing: a user whose notice lapsed still has
  // to be able to see, pay for and close a booking they already made, and has to
  // be able to answer or decline a call that is already ringing.
  it('leaves an in-flight booking readable and payable', () => {
    const src = read('bookingRoutes.ts');
    for (const route of ['getMyBookings', 'getBookingDetail', 'initiatePayment', 'getBookingReceipt']) {
      const block = routeBlock(src, new RegExp(`${route}\\)?\\s*;`));
      expect(block, `${route} must not be gated by re-consent`).not.toContain('requireReConsent()');
    }
  });

  it('leaves answering or ending an existing call possible', () => {
    const src = read('callRoutes.ts');
    for (const route of ['acceptCall', 'endCall']) {
      const block = routeBlock(src, new RegExp(`${route}\\)?\\s*;`));
      expect(block, `${route} must not be gated by re-consent`).not.toContain('requireReConsent()');
    }
  });

  it('still lets a blocked user read and reply to an existing thread', () => {
    const src = read('messageRoutes.ts');
    expect(routeBlock(src, /messageController\.getConversations/)).not.toContain('requireReConsent()');
    expect(routeBlock(src, /messageController\.getMessages/)).not.toContain('requireReConsent()');
  });
});

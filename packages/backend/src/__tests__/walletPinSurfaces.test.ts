import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the "partner withdrawal button does nothing" and "PIN entry does
 * nothing" reports. Both are cross-file contract defects: no single function is
 * wrong, the pieces simply do not line up, and nothing renders an error.
 */

const REPO = join(__dirname, '../../..');
const WEB = join(REPO, 'web/src');
const MOBILE = join(REPO, 'mobile');
const BACKEND = join(REPO, 'backend/src');

const read = (p: string) => readFileSync(join(WEB, p), 'utf8');
const readMobile = (p: string) => readFileSync(join(MOBILE, p), 'utf8');
const readBackend = (p: string) => readFileSync(join(BACKEND, p), 'utf8');

describe('withdrawal is reachable from the partner surface', () => {
  it('exposes the wallet money routes to partners as well as users', () => {
    // The partner wallet's Withdraw button links to /wallet/withdraw. That route
    // lived inside the `allowedRoles={['USER']}` group, so ProtectedRoute
    // bounced the partner to /partner/dashboard with `replace` — no back-stack
    // entry, no error, the form never rendered. `POST /api/wallet/withdraw` is
    // role-agnostic (authenticateToken + requireKycVerified), so the guard was
    // never protecting anything.
    const app = read('App.tsx');
    const shared = app.indexOf('<Route element={<ProtectedRoute allowedRoles={[\'USER\', \'PARTNER\']} />}>');
    expect(shared).toBeGreaterThan(-1);
    const block = app.slice(shared, shared + 1200);
    for (const path of ['/wallet/withdraw', '/wallet/topup', '/wallet/transactions', '/wallet/history']) {
      expect(block).toContain(`path="${path}"`);
    }
  });

  it('points every partner withdraw CTA at a route a partner can open', () => {
    // The partner wallet owns the Withdraw button; the performance page routes
    // through the partner wallet rather than the shared form directly.
    expect(read('pages/partner/PartnerWalletPage.tsx')).toContain('/wallet/withdraw');
    expect(read('pages/partner/PartnerPerformancePage.tsx')).toContain('/partner/wallet');
    expect(read('pages/partner/PartnerDashboardPage.tsx')).toContain('/partner/wallet');
  });

  it('sends the withdrawal method and account detail the API requires', () => {
    // `POST /wallet/withdraw` validates `amount`, `method` (BANK_TRANSFER|UPI)
    // and a non-empty `accountDetail`. CarryBuddyEarningsPage posted only
    // `{ amount }`, so every tap was a 422 that the catch block swallowed.
    const page = read('pages/carry/CarryBuddyEarningsPage.tsx');
    expect(page).not.toMatch(/api\.post\('\/wallet\/withdraw',\s*\{\s*amount/);
    expect(page).toContain("navigate('/wallet/withdraw'");
    expect(page).not.toMatch(/silently fail/);
  });

  it('uploads top-up proof to the route the API actually exposes', () => {
    // The API route is `POST /api/wallet/:id/topup-proof`; the client was
    // posting to `/wallet/topup-requests/${id}/topup-proof`, so every proof
    // upload 404'd.
    const api = read('lib/api.ts');
    expect(api).toContain('`/wallet/${id}/topup-proof`');
    expect(api).not.toContain('`/wallet/topup-requests/${id}/topup-proof`');
    expect(readBackend('routes/walletRoutes.ts')).toContain('"/:id/topup-proof"');
  });

  it('publishes a real withdrawable amount instead of leaving clients to guess', () => {
    // `Wallet` has no stored withdrawable column, so the mobile wallet read
    // `wallet.withdrawable`, found nothing, and rendered the literal "₹NaN".
    const ctrl = readBackend('controllers/walletController.ts');
    expect(ctrl).toMatch(/withdrawable:\s*Number\(wallet\.balance\)/);
    expect(ctrl).toMatch(/amountInFlight/);
    // requestWithdrawal debits the wallet when the payout opens, so the balance
    // is already net of anything in flight. Subtracting it again would
    // under-report the withdrawable amount and hide real available funds.
    expect(ctrl).not.toMatch(/withdrawable:\s*Math\.max\(0,\s*Number\(wallet\.balance\)\s*-/);
    const money = readMobile('app/(tabs)/wallet.tsx');
    expect(money).toMatch(/Number\.isFinite\(Number\(n\)\)/);
  });

  it('blocks a second withdrawal in the form, not with a 400 at the end', () => {
    // `requestWithdrawal` allows one open PENDING/PROCESSING request per user
    // and rejects the rest with DUPLICATE_WITHDRAWAL. The form collected the
    // whole payout detail first and only then hit that, so the user re-typed
    // their account number and IFSC to be told no.
    const form = read('pages/wallet/WithdrawalPage.tsx');
    expect(form).toMatch(/hasOpenWithdrawalRequest/);
    expect(form).toMatch(/disabled=\{balanceLoading \|\| hasOpenWithdrawal\}/);
    expect(form).toMatch(/loading \|\| balanceLoading \|\| hasOpenWithdrawal/);
    // The prefill from the earnings/wallet hand-off must only ever be a number.
    expect(form).toMatch(/Number\.isFinite\(suggested\) && suggested > 0/);
  });

  it('keeps the partner earnings counter in step with payouts', () => {    // `PartnerEarnings.withdrawableBalance` only ever incremented, so the
    // dashboard's "Available to withdraw" grew forever and disagreed with the
    // wallet balance the withdrawal gate actually validates.
    const admin = readBackend('controllers/adminController.ts');
    const start = admin.indexOf('export async function approveWithdrawal');
    const body = admin.slice(start, start + 4000);
    expect(body).toMatch(/partnerEarnings\.update/);
    expect(body).toMatch(/Math\.max\(0,\s*remaining\)/);
    // A `{ decrement }` that goes negative is rejected by Postgres, and catching
    // that inside an interactive transaction aborts the whole approval.
    expect(body).not.toMatch(/withdrawableBalance:\s*\{\s*decrement/);
    expect(body).not.toMatch(/partnerEarnings\.updateMany\([^)]*catch/);
  });
});

describe('app-lock PIN accepts the length it was set up with', () => {
  it('auto-submits at the stored PIN length, not a hardcoded four', () => {
    // A SHA-256 hash carries no length, so the keypad used to submit at four
    // digits. A 5- or 6-digit PIN could never be entered: the 4-digit prefix
    // was hashed, compared, failed, the buffer was wiped, and every attempt
    // counted toward the 30s lockout.
    const screen = read('components/LockScreen.tsx');
    expect(screen).toContain('expectedLength');
    expect(screen).toMatch(/next\.length === expectedLength/);
    expect(screen).not.toMatch(/next\.length >= 4/);
    expect(screen).not.toMatch(/value\.length < 4/);
  });

  it('persists the PIN length alongside the hash', () => {
    const lock = read('lib/appLock.tsx');
    expect(lock).toMatch(/pinLength\?:\s*number/);
    expect(lock).toMatch(/pinLength:\s*pin\.length/);
    expect(lock).toMatch(/pinLength:\s*newPin\.length/);
    // Legacy installs predate the field; the only length that could ever have
    // been set up successfully back then was four.
    expect(lock).toMatch(/pinLength:\s*settings\.pinLength \?\? MIN_PIN_LENGTH/);
  });

  it('shares one set of PIN length bounds with the setup flow', () => {
    const settings = read('pages/settings/SettingsPage.tsx');
    expect(settings).toContain('MIN_PIN_LENGTH');
    expect(settings).toContain('MAX_PIN_LENGTH');
    expect(settings).not.toMatch(/pin1\.length < 4/);
    expect(settings).not.toMatch(/prev\.length < 6/);
  });
});

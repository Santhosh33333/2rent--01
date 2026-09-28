import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAdminTierRole, resolveActiveRole, resolveSessionActiveRole } from '../rbac/activeRole';
import { ADMIN_ROLES } from '../rbac/sections';
import { guardRole } from '../rbac/permissions';

/**
 * Guards "the admin account shows the user screen instead of the admin screen".
 *
 * `resolveActiveRole` deliberately honours a delegated admin's USER/PARTNER
 * preview, and that behaviour is correct for a request already in flight. The
 * bug was that the *same* value was also treated as the session role by every
 * sign-in response and by the web client's landing/nav/gating logic, so one
 * switch to "User" permanently stranded an administrator on the customer app:
 * the web app read `activeRole` before `role` (and `role` was unreachable dead
 * code because `activeRole` is never falsy), SplashPage/LoginPage landed them
 * on /dashboard, Layout rendered the customer nav, and AdminLoginPage rejected
 * the account outright and logged it out.
 *
 * The fix separates the two concepts: the account type (`role`) grants admin
 * access and decides the landing surface, while `activeRole` stays a preview.
 */
describe('session role resolution', () => {
  it('advertises the account type on every sign-in for admin-tier accounts', () => {
    // This is what the stale value used to bypass: only email+password login
    // healed it, so OTP / phone-OTP / Google / Apple / verify-password sign-ins
    // all handed the web client the stale preview.
    for (const role of ADMIN_ROLES) {
      expect(resolveSessionActiveRole(role, 'USER')).toBe(role);
      expect(resolveSessionActiveRole(role, 'PARTNER')).toBe(role);
      expect(resolveSessionActiveRole(role, null)).toBe(role);
      expect(resolveSessionActiveRole(role, undefined)).toBe(role);
    }
  });

  it('revokes admin access from a demoted account with a stale admin preview', () => {
    // Every admin guard keys off `activeRole`, so a leftover admin value on a
    // demoted account (role -> USER) was a live privilege escalation.
    expect(resolveActiveRole('USER', 'SUPPORT_ADMIN')).toBe('USER');
    expect(resolveActiveRole('PARTNER', 'SUPER_ADMIN')).toBe('PARTNER');
    expect(resolveSessionActiveRole('USER', 'SUPER_ADMIN')).toBe('USER');
  });

  it('leaves non-admin role switching alone', () => {
    expect(resolveSessionActiveRole('USER', 'PARTNER')).toBe('PARTNER');
    expect(resolveSessionActiveRole('PARTNER', null)).toBe('PARTNER');
    expect(resolveSessionActiveRole('PARTNER', 'USER')).toBe('USER');
  });

  it('recognises every admin-tier role the backend allows', () => {
    for (const role of ADMIN_ROLES) {
      expect(isAdminTierRole(role)).toBe(true);
    }
    expect(isAdminTierRole('USER')).toBe(false);
    expect(isAdminTierRole('PARTNER')).toBe(false);
    expect(isAdminTierRole(null)).toBe(false);
    expect(isAdminTierRole(undefined)).toBe(false);
  });
});

/**
 * The web app was fixed for this, but the *backend* guards were not, and the
 * consequence was that a real account was locked out of the entire console.
 *
 * The live root admin had `role = SUPER_ADMIN` with `activeRole = USER`.
 * `resolveActiveRole` honours that preview on purpose, and every server guard
 * then read `activeRole || role` - so `requireAdmin` and `requireSectionAction`
 * both resolved the account to "USER" and returned 403 for all admin routes.
 * That includes the screens an admin needs to correct a user's phone number or
 * answer a support ticket: the very work the preview is supposed to let them do
 * side-by-side.
 *
 * Authorization must depend on who the account IS, not on which surface it is
 * currently looking at.
 */
describe('server-side admin guards authorize on the account role, not the preview', () => {
  it('resolves an admin-tier account to its own role even with a USER preview', () => {
    for (const role of ADMIN_ROLES) {
      expect(guardRole({ role, activeRole: 'USER' })).toBe(role);
      expect(guardRole({ role, activeRole: 'PARTNER' })).toBe(role);
    }
  });

  it('never lets a preview escalate a non-admin account', () => {
    // The other half of the rule: a USER/PARTNER account must not borrow admin
    // authority from a stale activeRole left behind by a demotion.
    expect(guardRole({ role: 'USER', activeRole: 'SUPER_ADMIN' })).toBe('USER');
    expect(guardRole({ role: 'USER', activeRole: 'SUPPORT_ADMIN' })).toBe('USER');
    expect(guardRole({ role: 'PARTNER', activeRole: 'SUPER_ADMIN' })).toBe('PARTNER');
  });

  it('falls back to activeRole only when the account role is absent', () => {
    // The auth middleware always populates `role` from the database, so this
    // branch is defensive only.
    expect(guardRole({ activeRole: 'PARTNER' })).toBe('PARTNER');
    expect(guardRole({ role: null, activeRole: 'PARTNER' })).toBe('PARTNER');
  });

  it('returns undefined for an unauthenticated request', () => {
    expect(guardRole(null)).toBeUndefined();
    expect(guardRole(undefined)).toBeUndefined();
    expect(guardRole({})).toBeUndefined();
  });

  it('keeps the shadowing expression out of the guards that caused the lockout', () => {
    const perms = readFileSync(join(__dirname, '../rbac/permissions.ts'), 'utf8');
    const auth = readFileSync(join(__dirname, '../middleware/auth.ts'), 'utf8');
    // `activeRole || role` is the exact expression that let a preview outrank
    // the real role. Its reappearance in a guard is the regression.
    for (const src of [perms, auth]) {
      expect(src).not.toMatch(/activeRole\s*\|\|\s*(req\.user\??\.)?role/);
    }
  });
});

/**
 * The web app cannot be unit tested from this package (it ships no test runner),
 * so the invariants that matter are asserted structurally against its source.
 * These are the exact expressions that caused the lockout, and the reappearance
 * of any of them is the regression worth preventing.
 */
const WEB = join(__dirname, '../../../web/src');
const read = (p: string) => readFileSync(join(WEB, p), 'utf8');

describe('web app resolves the account role, not the preview', () => {
  it('exposes one canonical admin-tier list', () => {
    const roles = read('lib/roles.ts');
    for (const role of ADMIN_ROLES) {
      expect(roles).toContain(`'${role}'`);
    }
    // The drift that hid the admin console: a 5-role copy in ProfilePage meant
    // SUPPORT_ADMIN / FINANCE_ADMIN / KYC_ADMIN / MARKETING_ADMIN /
    // PARTNER_ADMIN never saw the Admin Portal shortcut.
    expect(read('pages/profile/ProfilePage.tsx')).toContain('isAdminTierRole');
    expect(read('pages/profile/ProfilePage.tsx')).not.toMatch(/const adminRoles\s*=/);
  });

  it('gates admin routes on the account type', () => {
    const route = read('components/ProtectedRoute.tsx');
    expect(route).toContain('resolveAccountRole');
    expect(route).toContain('isAdminTierRole(accountRole)');
    // allowedRoles on an admin route is matched against the account type, so a
    // USER preview cannot be checked against the /admin allow-list.
    expect(route).toMatch(/allowedRoles\.includes\(accountRole\)/);
    // The shadowing expression itself must stay gone.
    expect(route).not.toMatch(/activeRole\s*\|\|\s*user\.activeRole\s*\|\|\s*user\.role/);
  });

  it('lands admin-tier accounts on their own console after sign-in and cold boot', () => {
    for (const page of ['pages/splash/SplashPage.tsx', 'pages/auth/LoginPage.tsx', 'pages/auth/RegisterPage.tsx']) {
      const src = read(page);
      expect(src).toContain('resolveLandingRole');
      expect(src).not.toMatch(/user\.activeRole\s*\|\|\s*user\.role/);
      expect(src).not.toMatch(/user\?\.activeRole\s*\|\|\s*user\?\.role/);
    }
  });

  it('does not reject an admin at the admin sign-in because of a USER preview', () => {
    // This handler used to read activeRole, print "This account does not have
    // admin access" and call logout() on a legitimate administrator.
    const src = read('pages/admin/AdminLoginPage.tsx');
    expect(src).toContain('resolveAccountRole');
    expect(src).toContain('isAdminTierRole');
    expect(src).not.toMatch(/activeRole\s*\|\|\s*user\.role/);
  });

  it('keeps one ROLE_DASHBOARDS map instead of four copies', () => {
    for (const file of ['components/RoleSwitcher.tsx', 'components/Layout.tsx', 'lib/roleContext.tsx']) {
      expect(read(file)).not.toMatch(/ROLE_DASHBOARDS\s*:\s*Record/);
    }
    expect(read('components/ProtectedRoute.tsx')).not.toMatch(/ROLE_DASHBOARDS\s*:\s*Record/);
  });

  it('offers admin-tier accounts a way back from a customer preview', () => {
    // Without an escape hatch the preview is indistinguishable from a demotion.
    expect(read('components/RoleSwitcher.tsx')).toContain('previewingFromAdmin');
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The root super admin account must be undeletable and undemotable by ANY other
 * super admin.
 *
 * The gap this covers: `updateAdminAccount`, the password reset, `blockUser` and
 * `demoteUserRole` all consulted `isPrimarySuperAdmin`, but `deleteUser` did not.
 * A second super admin could therefore hard-delete the owner account outright,
 * and the audit trail was written before the delete so the row vanished with no
 * obvious trace in the UI.
 *
 * The guards are asserted structurally because the controller module pulls in the
 * whole service graph; this matches the convention used by roleAccess /
 * walletPinSurfaces.
 */
const controllerSrc = readFileSync(join(__dirname, '..', 'controllers', 'adminController.ts'), 'utf8');
const routesSrc = readFileSync(join(__dirname, '..', 'routes', 'adminRoutes.ts'), 'utf8');

function handlerBody(name: string): string {
  const start = controllerSrc.indexOf(`export async function ${name}(`);
  expect(start, `handler ${name} not found`).toBeGreaterThan(-1);
  const next = controllerSrc.indexOf('export async function ', start + 1);
  return controllerSrc.slice(start, next === -1 ? undefined : next);
}

describe('protected root super admin', () => {
  it('normalises the email comparison so casing cannot bypass the lock', () => {
    const helperStart = controllerSrc.indexOf('function isPrimarySuperAdmin');
    expect(helperStart).toBeGreaterThan(-1);
    const helper = controllerSrc.slice(helperStart, helperStart + 600);

    expect(helper).toContain('.trim().toLowerCase()');
    // Both sides must be normalised: comparing only the stored email leaves
    // "Santhoshkrishna958@Gmail.com" free to be deleted.
    expect(helper).toMatch(/\(email \?\? ""\)\.trim\(\)\.toLowerCase\(\)/);
  });

  it('blocks deletion by anyone, keyed on the email rather than the current role', () => {
    const body = handlerBody('deleteUser');

    expect(body).toContain('isPrimarySuperAdmin(target.email)');
    expect(body).toContain('PROTECTED_ACCOUNT');

    // The guard must not be conditioned on the target still being a SUPER_ADMIN:
    // that makes "demote first, then delete" a bypass path.
    expect(body).not.toMatch(/isPrimarySuperAdmin\(target\.email\)[\s\S]{0,120}target\.role === "SUPER_ADMIN"/);
    expect(body).not.toMatch(/target\.role === "SUPER_ADMIN" && isPrimarySuperAdmin/);
  });

  it('runs the guard before the row is deleted and before the audit write', () => {
    const body = handlerBody('deleteUser');
    const guardAt = body.indexOf('isPrimarySuperAdmin(target.email)');
    const deleteAt = body.indexOf('prisma.user.delete');
    const auditAt = body.indexOf('prisma.auditLog.create');

    expect(guardAt).toBeGreaterThan(-1);
    expect(deleteAt).toBeGreaterThan(-1);
    // Guard first, then audit, then delete. The reverse order would still record
    // a DELETE_USER row for a request that was actually refused.
    expect(guardAt).toBeLessThan(auditAt);
    expect(auditAt).toBeLessThan(deleteAt);
  });

  it('keeps demotion locked for the same account', () => {
    const body = handlerBody('demoteUserRole');
    expect(body).toContain('isPrimarySuperAdmin(target.email)');
    expect(body).not.toMatch(/target\.role === "SUPER_ADMIN" && isPrimarySuperAdmin/);
  });

  it('keeps the account unblockable and unmodifiable', () => {
    expect(handlerBody('blockUser')).toContain('isPrimarySuperAdmin(target.email)');
    expect(handlerBody('updateAdminAccount')).toContain('isPrimarySuperAdmin(target.email)');
  });

  it('still requires super admin for the destructive routes', () => {
    expect(routesSrc).toMatch(/router\.delete\("\/users\/:id", requireSuperAdmin,/);
    expect(routesSrc).toMatch(/router\.delete\("\/communities\/:id", requireSuperAdmin,/);
    expect(routesSrc).toMatch(/router\.post\("\/users\/:userId\/demote", requireSuperAdmin,/);
  });
});

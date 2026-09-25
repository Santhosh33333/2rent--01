import { describe, expect, it } from 'vitest';
import { resolveActiveRole } from '../rbac/activeRole';
import { permissionsForRole } from '../rbac/sections';

describe('admin role switching and delegated access', () => {
  it('preserves an admin-selected USER or PARTNER view', () => {
    expect(resolveActiveRole('SUPER_ADMIN', 'USER')).toBe('USER');
    expect(resolveActiveRole('SUPPORT_ADMIN', 'PARTNER')).toBe('PARTNER');
  });

  it('heals stale admin roles to the account role', () => {
    expect(resolveActiveRole('FINANCE_ADMIN', 'MODERATOR')).toBe('FINANCE_ADMIN');
    expect(resolveActiveRole('SUPPORT_ADMIN', null)).toBe('SUPPORT_ADMIN');
  });

  it('leaves non-admin role switching unchanged', () => {
    expect(resolveActiveRole('USER', 'PARTNER')).toBe('PARTNER');
    expect(resolveActiveRole('PARTNER', null)).toBe('PARTNER');
  });

  it.each(['MODERATOR', 'SUPPORT', 'FINANCE'])('%s promotions receive a non-empty least-privilege default', (role) => {
    expect(permissionsForRole(role).length).toBeGreaterThan(0);
  });
});

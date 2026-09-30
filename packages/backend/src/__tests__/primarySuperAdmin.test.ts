/**
 * The primary super admin is break-glass: it must always be able to sign in.
 *
 * The account was found SUSPENDED in production, which made every login return
 * 403 "Account is not active." Because lifting a suspension needs an
 * authenticated admin, the account had no way to rescue itself. The guard that
 * should have prevented this returned false whenever ADMIN_EMAIL was unset,
 * which silently turned the protection off.
 *
 * Set ADMIN_EMAIL to whichever address is the real break-glass owner.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { prisma } from '../config/database'

vi.mock('../config/database', () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

const ADMIN_EMAIL = 'santhoshkrishna958@gmail.com'

async function loadModule(adminEmail: string | undefined) {
  vi.resetModules()
  vi.doMock('../config/env', () => ({ env: { ADMIN_EMAIL: adminEmail } }))
  return import('../rbac/primarySuperAdmin.js')
}

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('primary super admin guard', () => {
  it('identifies the account by ADMIN_EMAIL, case-insensitively', async () => {
    const { isPrimarySuperAdmin } = await loadModule(ADMIN_EMAIL)
    expect(isPrimarySuperAdmin('SANTHOSHKRISHNA958@GMAIL.COM')).toBe(true)
    expect(isPrimarySuperAdmin('someone-else@example.com')).toBe(false)
    expect(isPrimarySuperAdmin(undefined)).toBe(false)
  })

  it('protects nobody when ADMIN_EMAIL is unset rather than everything', async () => {
    const { isPrimarySuperAdmin } = await loadModule(undefined)
    expect(isPrimarySuperAdmin(ADMIN_EMAIL)).toBe(false)
  })

  it('refuses to suspend the primary super admin', async () => {
    const { assertNotPrimarySuperAdmin } = await loadModule(ADMIN_EMAIL)
    expect(() => assertNotPrimarySuperAdmin(ADMIN_EMAIL)).toThrow(/cannot be suspended/i)
    expect(() => assertNotPrimarySuperAdmin('other@example.com')).not.toThrow()
  })
})

describe('ensurePrimarySuperAdminActive', () => {
  it('clears a suspension and restores the admin surface', async () => {
    const { ensurePrimarySuperAdminActive } = await loadModule(ADMIN_EMAIL)
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: 'admin-1',
      status: 'SUSPENDED',
      activeRole: 'USER',
      role: 'SUPER_ADMIN',
      suspendedUntil: null,
    })
    ;(prisma.user.update as any).mockResolvedValue({})
    ;(prisma.auditLog.create as any).mockResolvedValue({})

    await ensurePrimarySuperAdminActive()

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: {
        status: 'ACTIVE',
        suspendedUntil: null,
        suspensionReason: null,
        activeRole: 'SUPER_ADMIN',
      },
    })
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'RESTORE_PRIMARY_SUPER_ADMIN' }),
      }),
    )
  })

  it('does nothing when the account is already healthy', async () => {
    const { ensurePrimarySuperAdminActive } = await loadModule(ADMIN_EMAIL)
    ;(prisma.user.findUnique as any).mockResolvedValue({
      id: 'admin-1',
      status: 'ACTIVE',
      activeRole: 'SUPER_ADMIN',
      role: 'SUPER_ADMIN',
      suspendedUntil: null,
    })

    await ensurePrimarySuperAdminActive()

    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(prisma.auditLog.create).not.toHaveBeenCalled()
  })

  it('tolerates a missing account instead of blocking startup', async () => {
    const { ensurePrimarySuperAdminActive } = await loadModule(ADMIN_EMAIL)
    ;(prisma.user.findUnique as any).mockResolvedValue(null)
    await expect(ensurePrimarySuperAdminActive()).resolves.toBeUndefined()
  })
})

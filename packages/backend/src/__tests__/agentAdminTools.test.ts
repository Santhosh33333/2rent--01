import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the admin agent tools and the section+action gate behind them.
 *
 * The point of these is the *grant*, not the query. A tool can only be reached by
 * a caller holding its named (section, action) permission, checked against the
 * real AdminUser row, and the check must hold at both the confirmation offer and
 * the execution.
 *
 * Two independent gates are exercised throughout, because both are load-bearing:
 * the static `roles` allowlist (which role may even see the tool) and the dynamic
 * (section, action) grant (whether this particular admin account was delegated
 * that authority).
 */

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_32chars_minimum!';
  process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_32chars_minimum!';
});

const mocks = vi.hoisted(() => ({
  userCount: vi.fn(),
  userFindFirst: vi.fn(),
  userFindUnique: vi.fn(),
  verificationCount: vi.fn(),
  walkingPartnerCount: vi.fn(),
  withdrawalCount: vi.fn(),
  withdrawalAggregate: vi.fn(),
  withdrawalFindMany: vi.fn(),
  withdrawalFindUnique: vi.fn(),
  adminUserFindUnique: vi.fn(),
  withdrawalUpdateMany: vi.fn(),
  transactionUpdateMany: vi.fn(),
  partnerEarningsFindUnique: vi.fn(),
  partnerEarningsUpdate: vi.fn(),
  auditLogCreate: vi.fn(),
  moneyTransaction: vi.fn(),
}))

vi.mock('../config/database', () => ({
  prisma: {
    user: { count: mocks.userCount, findFirst: mocks.userFindFirst, findUnique: mocks.userFindUnique },
    verification: { count: mocks.verificationCount },
    walkingPartner: { count: mocks.walkingPartnerCount },
    withdrawalRequest: {
      count: mocks.withdrawalCount,
      aggregate: mocks.withdrawalAggregate,
      findMany: mocks.withdrawalFindMany,
      findUnique: mocks.withdrawalFindUnique,
    },
    adminUser: { findUnique: mocks.adminUserFindUnique },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: mocks.moneyTransaction,
  },
}))

vi.mock('../services/emailService', () => ({
  sendWithdrawalPaidEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendWithdrawalRejectedEmail: vi.fn().mockResolvedValue({ sent: true }),
  sendWithdrawalRequestedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

import { runAgentTool, __resetConfirmationsForTests, setAuditSink } from '../agent/toolRouter'
import { toolSchemasForRole } from '../agent/toolRegistry'
import type { AgentToolContext } from '../agent/toolRegistry'
import '../agent/tools/adminTools'

const ADMIN_USER = 'cccccccc-3333-4333-8333-cccccccccccc'
const TARGET_USER = 'dddddddd-4444-4444-8444-dddddddddddd'

function adminCtx(role: string, overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    userId: ADMIN_USER,
    role,
    accountRole: role,
    isAdminTier: true,
    sessionId: 'sess-admin',
    ...overrides,
  }
}

/** Grants the AdminUser row a specific permission list for a given role. */
function grant(permissions: string[], role = 'SUPPORT') {
  mocks.adminUserFindUnique.mockResolvedValue({
    permissions: permissions.length ? JSON.stringify(permissions) : null,
    role: { name: role, permissions: '[]' },
    user: { role, activeRole: null },
  });
}

function useTransaction() {
  const tx = {
    withdrawalRequest: { updateMany: mocks.withdrawalUpdateMany },
    transaction: { updateMany: mocks.transactionUpdateMany },
    partnerEarnings: { findUnique: mocks.partnerEarningsFindUnique, update: mocks.partnerEarningsUpdate },
    auditLog: { create: mocks.auditLogCreate },
  }
  mocks.moneyTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx))
  return tx
}

async function tokenFor(toolName: string, args: unknown, c: AgentToolContext) {
  const outcome = await runAgentTool(c, { toolName, args })
  if (outcome.status !== 'confirmation_required') {
    // Surface the tool's own error rather than a bare status mismatch; a stubbed
    // Prisma method that does not exist shows up as an opaque failure otherwise.
    throw new Error(`${toolName} should have asked for confirmation, got: ${JSON.stringify(outcome)}`)
  }
  return outcome.confirmation.token
}

/** Narrows a success outcome, reporting the real failure when there is one. */
function ok<T>(outcome: { status: string; data?: unknown; code?: string; message?: string }, toolName: string): T {
  if (outcome.status !== 'success') {
    throw new Error(`${toolName} failed: ${JSON.stringify(outcome)}`)
  }
  return outcome.data as T
}

const pendingWithdrawal = {
  id: 'wr-1',
  amount: 1000,
  method: 'BANK_TRANSFER',
  status: 'PENDING',
  createdAt: new Date('2026-02-01T10:00:00.000Z'),
  accountDetail: JSON.stringify({ accountNumber: '411111111111', ifsc: 'HDFC0000123', accountHolderName: 'Asha Rao' }),
  user: { id: TARGET_USER, fullName: 'Asha Rao', email: 'asha@nubra.app' },
}

describe('admin tools', () => {
  beforeEach(() => {
    __resetConfirmationsForTests()
    vi.clearAllMocks()
    setAuditSink(() => {})

    grant(['ANALYTICS.VIEW', 'USERS.VIEW', 'WITHDRAWALS.VIEW'])

    mocks.userCount.mockResolvedValue(120)
    mocks.verificationCount.mockResolvedValue(7)
    mocks.walkingPartnerCount.mockResolvedValue(31)
    mocks.withdrawalCount.mockResolvedValue(4)
    mocks.withdrawalAggregate.mockResolvedValue({ _sum: { amount: 25000 } })
    mocks.withdrawalFindMany.mockResolvedValue([])
    mocks.withdrawalFindUnique.mockResolvedValue(pendingWithdrawal)
    mocks.auditLogCreate.mockResolvedValue({})
    useTransaction()
  })

  describe('the section+action gate', () => {
    it('refuses a delegated admin who lacks the named grant', async () => {
      grant(['SUPPORT.VIEW']) // real admin tier, no ANALYTICS grant

      const outcome = await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_get_platform_stats', args: {} })

      expect(outcome.status).toBe('denied')
      if (outcome.status !== 'denied') throw new Error('expected denied')
      expect(outcome.code).toBe('PERMISSION_DENIED')
      expect(mocks.userCount).not.toHaveBeenCalled()
    })

    it('allows a delegated admin who holds the exact grant', async () => {
      const outcome = await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_get_platform_stats', args: {} })
      expect(outcome.status).toBe('success')
    })

    it('honours a per-account section wildcard', async () => {
      grant(['ANALYTICS.*'])
      const outcome = await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_get_platform_stats', args: {} })
      expect(outcome.status).toBe('success')
    })

    it('lets a super admin through without any explicit grant', async () => {
      mocks.adminUserFindUnique.mockResolvedValue({
        permissions: null,
        role: { name: 'SUPER_ADMIN', permissions: '[]' },
        user: { role: 'SUPER_ADMIN', activeRole: null },
      })

      const outcome = await runAgentTool(adminCtx('SUPER_ADMIN'), { toolName: 'admin_get_platform_stats', args: {} })
      expect(outcome.status).toBe('success')
    })

    it('refuses an admin previewing the customer app', async () => {
      // activeRole USER is a view, not authority: requireAdmin refuses these too.
      mocks.adminUserFindUnique.mockResolvedValue({
        permissions: null,
        role: { name: 'ADMIN', permissions: JSON.stringify(['ANALYTICS.VIEW']) },
        user: { role: 'ADMIN', activeRole: 'USER' },
      })

      const outcome = await runAgentTool(
        adminCtx('ADMIN', { role: 'USER', accountRole: 'ADMIN' }),
        { toolName: 'admin_get_platform_stats', args: {} }
      )
      expect(outcome.status).toBe('denied')
    })

    it('refuses a non-admin even if it somehow claims the admin tier', async () => {
      const outcome = await runAgentTool(
        adminCtx('USER', { isAdminTier: true }),
        { toolName: 'admin_get_platform_stats', args: {} }
      )
      expect(outcome.status).toBe('denied')
    })

    it('re-checks the grant before the confirmed write, not only before the offer', async () => {
      grant(['WITHDRAWALS.VIEW', 'WITHDRAWALS.APPROVE'], 'FINANCE')
      const finance = adminCtx('FINANCE')
      const token = await tokenFor('admin_approve_withdrawal', { withdrawalId: 'wr-1' }, finance)
      expect(mocks.withdrawalUpdateMany).not.toHaveBeenCalled()

      grant(['WITHDRAWALS.VIEW'], 'FINANCE') // APPROVE revoked mid-flight

      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('denied')
      if (outcome.status !== 'denied') throw new Error('expected denied')
      expect(outcome.code).toBe('PERMISSION_DENIED')
      expect(mocks.withdrawalUpdateMany).not.toHaveBeenCalled()
    })
  })

  describe('role allowlist', () => {
    it('keeps a SUPPORT admin out of the money tools entirely', async () => {
      grant(['WITHDRAWALS.VIEW', 'WITHDRAWALS.APPROVE'], 'SUPPORT')

      const outcome = await runAgentTool(adminCtx('SUPPORT'), {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
      })

      // SUPPORT is deliberately absent from this tool's roles, so it is refused
      // even with the grant in hand.
      expect(outcome.status).toBe('denied')
      if (outcome.status !== 'denied') throw new Error('expected denied')
      expect(outcome.code).toBe('TOOL_FORBIDDEN')
    })
  })

  describe('schema exposure', () => {
    it('hides admin tools from a plain user', () => {
      const names = toolSchemasForRole('USER', false).map((t) => t.function.name)
      expect(names.some((n) => n.startsWith('admin_'))).toBe(false)
    })

    it('hides the money tool from a delegated admin without the finance role', () => {
      const names = toolSchemasForRole('SUPPORT', true).map((t) => t.function.name)
      expect(names).toContain('admin_get_platform_stats')
      expect(names).not.toContain('admin_approve_withdrawal')
    })

    it('offers the money tool to a finance admin that holds the grant', () => {
      const names = toolSchemasForRole('FINANCE', true).map((t) => t.function.name)
      expect(names).toContain('admin_approve_withdrawal')
    })
  })

  describe('admin_get_platform_stats', () => {
    it('counts every KYC state a human still has to review', async () => {
      await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_get_platform_stats', args: {} })
      expect(mocks.verificationCount).toHaveBeenCalledWith({
        where: { status: { in: ['SUBMITTED', 'PENDING_REVIEW', 'UNDER_VERIFICATION'] } },
      })
    })

    it('reports the real payout queue total', async () => {
      const outcome = await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_get_platform_stats', args: {} })
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))
      const data = ok<{ withdrawals: { pendingCount: number; pendingAmount: number } }>(outcome, 'admin_get_platform_stats')
      expect(data.withdrawals.pendingCount).toBe(4)
      expect(data.withdrawals.pendingAmount).toBe(25000)
    })
  })

  /**
   * Regression: registering a tool whose schema this converter cannot render used
   * to throw inside toolSchemasForRole, which is what /capabilities returns and
   * what the model is allowed to see. One bad schema took the assistant offline
   * for every role on the platform.
   */
  describe('schema rendering resilience', () => {
    it('still serves every other tool when one schema cannot be rendered', async () => {
      // SUPPORT is on the read tools and off the money ones, so it should see
      // exactly those two admin schemas rather than a blanked list.
      const names = toolSchemasForRole('SUPPORT', true).map((t) => t.function.name)
      const adminNames = names.filter((n) => n.startsWith('admin_'))

      expect(adminNames).toEqual(['admin_get_platform_stats', 'admin_find_user'])
    })

    it('renders a JSON Schema for every tool it does expose', () => {
      for (const s of toolSchemasForRole('SUPER_ADMIN', true)) {
        expect(s.function.parameters, `${s.function.name} has no schema`).toBeTruthy()
        expect(s.function.description.length).toBeGreaterThan(0)
      }
    })
  })

  describe('admin_find_user', () => {
    it('reports a missing user rather than an empty success', async () => {
      mocks.userFindFirst.mockResolvedValue(null)
      const outcome = await runAgentTool(adminCtx('SUPPORT'), {
        toolName: 'admin_find_user',
        args: { email: 'nobody@example.com' },
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('USER_NOT_FOUND')
    })

    it('requires at least one identifier', async () => {
      const outcome = await runAgentTool(adminCtx('SUPPORT'), { toolName: 'admin_find_user', args: {} })
      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('MISSING_IDENTIFIER')
      expect(mocks.userFindFirst).not.toHaveBeenCalled()
    })
  })

  describe('admin_list_withdrawals', () => {
    it('masks the payout destination for a viewer without APPROVE', async () => {
      grant(['WITHDRAWALS.VIEW'], 'FINANCE')
      mocks.withdrawalFindMany.mockResolvedValue([pendingWithdrawal])

      const outcome = await runAgentTool(adminCtx('FINANCE'), {
        toolName: 'admin_list_withdrawals',
        args: { status: 'PENDING' },
      })
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))

      const data = ok<{
        destinationVisible: boolean
        withdrawals: Array<{ destination: Record<string, unknown> | null }>
      }>(outcome, 'admin_list_withdrawals')
      expect(data.destinationVisible).toBe(false)
      expect(data.withdrawals[0].destination?.accountNumber).toBe('****1111')
      expect(data.withdrawals[0].destination?.accountHolderName).not.toBe('Asha Rao')
    })

    it('reveals the destination to a caller who may also approve', async () => {
      grant(['WITHDRAWALS.VIEW', 'WITHDRAWALS.APPROVE'], 'FINANCE')
      mocks.withdrawalFindMany.mockResolvedValue([pendingWithdrawal])

      const outcome = await runAgentTool(adminCtx('FINANCE'), {
        toolName: 'admin_list_withdrawals',
        args: { status: 'PENDING' },
      })
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))

      const data = ok<{
        destinationVisible: boolean
        withdrawals: Array<{ destination: Record<string, unknown> | null }>
      }>(outcome, 'admin_list_withdrawals')
      expect(data.destinationVisible).toBe(true)
      expect(data.withdrawals[0].destination?.accountNumber).toBe('411111111111')
      // Still never widened to the holder's name, which approving does not need.
      expect(data.withdrawals[0].destination?.accountHolderName).toBeUndefined()
    })

    it('masks a UPI destination too', async () => {
      grant(['WITHDRAWALS.VIEW'], 'FINANCE')
      mocks.withdrawalFindMany.mockResolvedValue([
        { ...pendingWithdrawal, method: 'UPI', accountDetail: JSON.stringify({ upiId: 'asharao@okbank' }) },
      ])

      const outcome = await runAgentTool(adminCtx('FINANCE'), { toolName: 'admin_list_withdrawals', args: {} })
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))
      const data = ok<{ withdrawals: Array<{ destination: Record<string, unknown> }> }>(outcome, 'admin_list_withdrawals')
      expect(data.withdrawals[0].destination.upiId).not.toContain('asharao')
      expect(data.withdrawals[0].destination.upiId).toContain('@okbank')
    })

    it('survives a corrupt accountDetail blob without failing the queue', async () => {
      grant(['WITHDRAWALS.VIEW'], 'FINANCE')
      mocks.withdrawalFindMany.mockResolvedValue([{ ...pendingWithdrawal, accountDetail: 'not json' }])

      const outcome = await runAgentTool(adminCtx('FINANCE'), { toolName: 'admin_list_withdrawals', args: {} })
      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))
      expect((outcome.data as { withdrawals: Array<{ destination: unknown }> }).withdrawals[0].destination).toBeNull()
    })
  })

  describe('admin_approve_withdrawal', () => {
    let finance: AgentToolContext

    beforeEach(() => {
      grant(['WITHDRAWALS.VIEW', 'WITHDRAWALS.APPROVE'], 'FINANCE')
      finance = adminCtx('FINANCE')
      mocks.withdrawalUpdateMany.mockResolvedValue({ count: 1 })
      mocks.transactionUpdateMany.mockResolvedValue({ count: 1 })
      mocks.partnerEarningsFindUnique.mockResolvedValue({ withdrawableBalance: 5000 })
      mocks.partnerEarningsUpdate.mockResolvedValue({})
      mocks.userFindFirst.mockResolvedValue({ email: 'asha@nubra.app', fullName: 'Asha Rao' })
    })

    it('does not settle anything without confirmation', async () => {
      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
      })
      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.withdrawalUpdateMany).not.toHaveBeenCalled()
    })

    it('settles the hold and the earnings figure once confirmed', async () => {
      const token = await tokenFor('admin_approve_withdrawal', { withdrawalId: 'wr-1' }, finance)

      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('success')
      expect(mocks.withdrawalUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'wr-1', status: 'PENDING' } })
      )
      // withdrawableBalance 5000 - 1000.
      expect(mocks.partnerEarningsUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { withdrawableBalance: 4000 } })
      )
      if (outcome.status !== 'success') throw new Error('unexpected: ' + JSON.stringify(outcome))
      expect((outcome.data as { status: string }).status).toBe('APPROVED')
    })

    it('never moves money twice when the claim loses the race', async () => {
      mocks.withdrawalUpdateMany.mockResolvedValue({ count: 0 })

      const token = await tokenFor('admin_approve_withdrawal', { withdrawalId: 'wr-1' }, finance)
      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('INVALID_STATUS')
      expect(mocks.transactionUpdateMany).not.toHaveBeenCalled()
      expect(mocks.partnerEarningsUpdate).not.toHaveBeenCalled()
    })

    it('refuses to approve a withdrawal that is not pending', async () => {
      mocks.withdrawalFindUnique.mockResolvedValue({ ...pendingWithdrawal, status: 'APPROVED' })

      const token = await tokenFor('admin_approve_withdrawal', { withdrawalId: 'wr-1' }, finance)
      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      expect(mocks.withdrawalUpdateMany).not.toHaveBeenCalled()
    })

    it('reports a withdrawal that does not exist', async () => {
      mocks.withdrawalFindUnique.mockResolvedValue(null)

      const token = await tokenFor('admin_approve_withdrawal', { withdrawalId: 'wr-missing' }, finance)
      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-missing' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('WITHDRAWAL_NOT_FOUND')
    })

    it('names the request in the confirmation text', async () => {
      const outcome = await runAgentTool(finance, {
        toolName: 'admin_approve_withdrawal',
        args: { withdrawalId: 'wr-1' },
      })
      if (outcome.status !== 'confirmation_required') throw new Error('expected confirmation_required')
      expect(outcome.confirmation.summary).toContain('wr-1')
    })
  })
})
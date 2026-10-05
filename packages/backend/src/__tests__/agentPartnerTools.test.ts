import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Tests for the partner agent tools.
 *
 * The withdrawal tests deliberately exercise the real withdrawalService rather
 * than a mock of it. Mocking the service would only prove that the tool calls a
 * function, not that the function still enforces the balance, minimum-amount and
 * single-open-withdrawal rules after it was extracted from the controller.
 */

// The partner tools import pricingEngine and withdrawalService, which reach
// config/env at module load. vitest.config.ts runs no global setup on purpose, so
// the minimum required vars are seeded here before those imports happen.
vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET ??= 'test_access_secret_32chars_minimum!';
  process.env.JWT_REFRESH_SECRET ??= 'test_refresh_secret_32chars_minimum!';
});

const mocks = vi.hoisted(() => ({
  walkingPartnerFindUnique: vi.fn(),
  verificationFindUnique: vi.fn(),
  applicationCount: vi.fn(),
  walletFindUnique: vi.fn(),
  withdrawalFindMany: vi.fn(),
  earningDetailFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  partnerEarningsFindUnique: vi.fn(),
  partnerEarningsCreate: vi.fn(),
  partnerLevelFindUnique: vi.fn(),
  walletFindFirst: vi.fn(),
  withdrawalReqFindFirst: vi.fn(),
  withdrawalReqCreate: vi.fn(),
  walletUpdate: vi.fn(),
  transactionCreate: vi.fn(),
  auditLogCreate: vi.fn(),
  moneyTransaction: vi.fn(),
}))

vi.mock('../config/database', () => ({
  prisma: {
    walkingPartner: { findUnique: mocks.walkingPartnerFindUnique },
    verification: { findUnique: mocks.verificationFindUnique },
    walkingRequestApplication: { count: mocks.applicationCount },
    wallet: { findUnique: mocks.walletFindUnique },
    withdrawalRequest: { findMany: mocks.withdrawalFindMany, findFirst: mocks.withdrawalReqFindFirst },
    earningDetail: { findMany: mocks.earningDetailFindMany },
    user: { findUnique: mocks.userFindUnique },
    partnerEarnings: { findUnique: mocks.partnerEarningsFindUnique, create: mocks.partnerEarningsCreate },
    partnerLevel: { findUnique: mocks.partnerLevelFindUnique },
    auditLog: { create: mocks.auditLogCreate },
    $transaction: mocks.moneyTransaction,
  },
}))

vi.mock('../services/emailService', () => ({
  sendWithdrawalRequestedEmail: vi.fn().mockResolvedValue({ sent: true }),
}))

import { runAgentTool, __resetConfirmationsForTests, setAuditSink } from '../agent/toolRouter'
import { createWithdrawalRequest } from '../services/withdrawalService'
import type { AgentToolContext } from '../agent/toolRegistry'
import type { AgentAuditRow } from '../agent/toolRouter'
import '../agent/tools/partnerTools'

const PARTNER_USER = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const UUID_W = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'

function partnerCtx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    userId: PARTNER_USER,
    role: 'PARTNER',
    accountRole: 'PARTNER',
    isAdminTier: false,
    sessionId: 'sess-partner',
    ...overrides,
  }
}

/** A plain user, used to prove partner tools are invisible to them. */
function userCtx(): AgentToolContext {
  return {
    userId: PARTNER_USER,
    role: 'USER',
    accountRole: 'USER',
    isAdminTier: false,
    sessionId: 'sess-user',
  }
}

async function tokenFor(toolName: string, args: unknown, ctx: AgentToolContext = partnerCtx()) {
  const outcome = await runAgentTool(ctx, { toolName, args })
  expect(outcome.status).toBe('confirmation_required')
  if (outcome.status !== 'confirmation_required') throw new Error('expected confirmation_required')
  return outcome.confirmation.token
}

/**
 * Wires the transaction callback against the mocks the service uses.
 *
 * tx.wallet.findUnique matters as much as the outer one: the service re-reads the
 * balance inside the transaction and must not debit funds that were already spent
 * between the pre-check and the commit. Leaving it unstubbed returned undefined
 * and made every successful-path test fail on an unrelated TypeError.
 */
function useTransaction(walletBalance = 5000) {
  const tx = {
    wallet: {
      findUnique: vi.fn().mockResolvedValue({ balance: walletBalance, promotionalBalance: 0, heldBalance: 0 }),
      update: mocks.walletUpdate,
    },
    withdrawalRequest: { findFirst: mocks.withdrawalReqFindFirst, create: mocks.withdrawalReqCreate },
    transaction: { create: mocks.transactionCreate },
  }
  mocks.moneyTransaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx))
  return tx
}

describe('partner tools', () => {
  beforeEach(() => {
    __resetConfirmationsForTests()
    vi.clearAllMocks()
    const rows: AgentAuditRow[] = []
    setAuditSink((row) => {
      rows.push(row)
    })

    mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'APPROVED', rating: 4.5, totalWalks: 9, totalEarnings: 3000, bankAccountNumber: null, bankAccountName: null, bankIfsc: null, upiId: 'saved@upi', rejectionReason: null })
    mocks.verificationFindUnique.mockResolvedValue({ status: 'VERIFIED' })
    mocks.applicationCount.mockResolvedValue(0)
    mocks.walletFindUnique.mockResolvedValue({ balance: 5000, promotionalBalance: 0, heldBalance: 200 })
    mocks.withdrawalFindMany.mockResolvedValue([])
    mocks.earningDetailFindMany.mockResolvedValue([])
    // Deliberately not an @example.com / test.* address: those are demo-account
    // patterns, and the demo withdrawal guard runs before the amount, balance and
    // duplicate checks, which would mask the rule each test is actually asserting.
    mocks.userFindUnique.mockResolvedValue({ email: 'walker@nubra.app' })
    mocks.partnerEarningsFindUnique.mockResolvedValue({
      todayEarnings: 100, weeklyEarnings: 400, monthlyEarnings: 1500, lifetimeEarnings: 9000,
      pendingEarnings: 250, withdrawableBalance: 3200, completedJobs: 9, cancelledJobs: 1,
      averageRating: 4.5, incentives: 50, bonuses: 100, commissionDeduction: 75,
      partnerLevel: null,
    })
    mocks.auditLogCreate.mockResolvedValue({})
    mocks.withdrawalReqFindFirst.mockResolvedValue(null)
    mocks.withdrawalReqCreate.mockResolvedValue({
      id: 'wr-1', amount: 1000, method: 'UPI', status: 'PENDING',
      createdAt: new Date(), accountDetail: JSON.stringify({ upiId: 'p@upi' }),
    })
    mocks.walletUpdate.mockResolvedValue({})
    mocks.transactionCreate.mockResolvedValue({})
    useTransaction()
  })

  describe('role gating', () => {
    it('denies every partner tool to a plain user', async () => {
      for (const name of ['get_my_earnings', 'get_my_partner_status', 'get_my_withdrawals', 'request_withdrawal']) {
        const outcome = await runAgentTool(userCtx(), { toolName: name, args: {} })
        expect(outcome.status, `${name} must be denied to USER`).toBe('denied')
      }
      expect(mocks.walletFindUnique).not.toHaveBeenCalled()
    })

    it('never reaches a handler for an unknown tool name', async () => {
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'drain_wallet', args: {} })
      expect(outcome.status).toBe('denied')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })
  })

  describe('get_my_earnings', () => {
    it('returns real earnings and derives spendable balance from held funds', async () => {
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_earnings', args: {} })

      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('expected success')
      const data = outcome.data as Record<string, number>
      expect(data.today).toBe(100)
      expect(data.withdrawable).toBe(3200)
      // 5000 balance minus 200 held: the raw balance is not the spendable figure.
      expect(data.spendableBalance).toBe(4800)
    })

    it('refuses when the partner is not approved', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'REJECTED', rejectionReason: 'Documents failed' })
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_earnings', args: {} })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('PARTNER_NOT_APPROVED')
    })

    it('treats a suspended partner as not approved', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'SUSPENDED', rating: 4.5, totalWalks: 9, totalEarnings: 0, bankAccountNumber: null, bankAccountName: null, bankIfsc: null, upiId: 'p@upi', rejectionReason: null })
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_earnings', args: {} })

      expect(outcome.status).toBe('failed')
    })
  })

  describe('get_my_partner_status', () => {
    it('reports the real blockers instead of claiming the partner can work', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'APPROVED', rating: 4.5, totalWalks: 9, totalEarnings: 3000, bankAccountNumber: null, bankAccountName: null, bankIfsc: null, upiId: null, rejectionReason: null })
      mocks.verificationFindUnique.mockResolvedValue({ status: 'PENDING_REVIEW' })

      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_partner_status', args: {} })
      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('expected success')

      const data = outcome.data as { canAcceptWalks: boolean; blockers: string[] }
      expect(data.canAcceptWalks).toBe(false)
      expect(data.blockers).toHaveLength(2)
    })

    it('says plainly when the account has never applied', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue(null)
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_partner_status', args: {} })

      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('expected success')
      expect((outcome.data as { isPartner: boolean }).isPartner).toBe(false)
    })
  })

  describe('get_my_withdrawals', () => {
    it('reports an open withdrawal so a second one is not attempted', async () => {
      mocks.withdrawalFindMany.mockResolvedValue([
        { id: 'wr-9', amount: 1000, method: 'UPI', status: 'PENDING', rejectionReason: null, createdAt: new Date(), reviewedAt: null },
      ])
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'get_my_withdrawals', args: { limit: 5 } })

      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('expected success')
      const data = outcome.data as { hasOpenWithdrawal: boolean; openWithdrawalId: string }
      expect(data.hasOpenWithdrawal).toBe(true)
      expect(data.openWithdrawalId).toBe('wr-9')
    })
  })

  describe('request_withdrawal', () => {
    const args = { amount: 1000, method: 'UPI' as const }

    it('does not move money without a confirmation token', async () => {
      const outcome = await runAgentTool(partnerCtx(), { toolName: 'request_withdrawal', args })

      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
      expect(mocks.withdrawalReqCreate).not.toHaveBeenCalled()
    })

    it('holds the funds and files the request once confirmed', async () => {
      const token = await tokenFor('request_withdrawal', args)
      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args, confirmationToken: token,
      })

      expect(outcome.status).toBe('success')
      expect(mocks.walletUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { decrement: 1000 } } })
      )
      expect(mocks.withdrawalReqCreate).toHaveBeenCalledTimes(1)
      if (outcome.status !== 'success') throw new Error('expected success')
      // Reported as held-for-review, not as paid.
      expect((outcome.data as { status: string }).status).toBe('PENDING')
    })

    it('reuses the saved UPI destination instead of asking the model for one', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'APPROVED', rating: 4.5, totalWalks: 9, totalEarnings: 3000, bankAccountNumber: null, bankAccountName: null, bankIfsc: null, upiId: 'saved@upi', rejectionReason: null })
      const token = await tokenFor('request_withdrawal', args)

      await runAgentTool(partnerCtx(), { toolName: 'request_withdrawal', args, confirmationToken: token })

      expect(mocks.withdrawalReqCreate.mock.calls[0][0].data.accountDetail).toContain('saved@upi')
    })

    it('refuses when no payout destination exists anywhere', async () => {
      mocks.walkingPartnerFindUnique.mockResolvedValue({ status: 'APPROVED', rating: 4.5, totalWalks: 9, totalEarnings: 3000, bankAccountNumber: null, bankAccountName: null, bankIfsc: null, upiId: null, rejectionReason: null })
      const token = await tokenFor('request_withdrawal', args)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args, confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('NO_PAYOUT_DESTINATION')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('still enforces the minimum withdrawal amount', async () => {
      const small = { amount: 10, method: 'UPI' as const }
      const token = await tokenFor('request_withdrawal', small)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args: small, confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('VALIDATION_ERROR')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('still refuses to withdraw more than the balance', async () => {
      const big = { amount: 40000, method: 'UPI' as const }
      mocks.walletFindUnique.mockResolvedValue({ balance: 5000 })
      const token = await tokenFor('request_withdrawal', big)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args: big, confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('INSUFFICIENT_FUNDS')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('refuses a second withdrawal while one is still open', async () => {
      mocks.withdrawalReqFindFirst.mockResolvedValue({ id: 'wr-existing' })
      const token = await tokenFor('request_withdrawal', args)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args, confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('DUPLICATE_WITHDRAWAL')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('blocks a demo account from pulling out real money', async () => {
      mocks.userFindUnique.mockResolvedValue({ email: 'partner@example.com' })
      const token = await tokenFor('request_withdrawal', args)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal', args, confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('DEMO_NO_WITHDRAW')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('rejects a token issued for a different amount', async () => {
      const token = await tokenFor('request_withdrawal', args)

      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal',
        args: { amount: 4000, method: 'UPI' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('denied')
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('names the amount and destination in the confirmation text', async () => {
      const outcome = await runAgentTool(partnerCtx(), {
        toolName: 'request_withdrawal',
        args: { amount: 2500, method: 'BANK_TRANSFER', accountDetail: { accountNumber: '411111111111', ifsc: 'HDFC0000123' } },
      })

      expect(outcome.status).toBe('confirmation_required')
      if (outcome.status !== 'confirmation_required') throw new Error('expected confirmation_required')
      const summary = outcome.confirmation.summary
      expect(summary).toContain('2500.00')
      expect(summary).toContain('1111') // last 4 of the account number
    })
  })

  /**
   * These call withdrawalService directly because the bug they cover lived in the
   * shared service, not in the tool: the REST path forwards req.body untouched
   * and the web client declares accountDetail as a JSON string, so a typed cast
   * silently turned a valid withdrawal into INVALID_ACCOUNT.
   */
  describe('withdrawalService destination decoding', () => {
    const base = { userId: PARTNER_USER, email: 'walker@nubra.app', amount: 1000, method: 'BANK_TRANSFER' }

    it('accepts the JSON string form the web client sends', async () => {
      const result = await createWithdrawalRequest({
        ...base,
        accountDetail: JSON.stringify({ accountNumber: '411111111111', ifsc: 'HDFC0000123' }),
      })

      expect(result.status).toBe('PENDING')
      expect(mocks.walletUpdate).toHaveBeenCalled()
    })

    it('still accepts a decoded object', async () => {
      const result = await createWithdrawalRequest({
        ...base,
        accountDetail: { accountNumber: '411111111111', ifsc: 'HDFC0000123' },
      })

      expect(result.status).toBe('PENDING')
    })

    it('rejects a malformed JSON string instead of throwing a parser error', async () => {
      await expect(createWithdrawalRequest({ ...base, accountDetail: '{not json' }))
        .rejects.toMatchObject({ code: 'INVALID_ACCOUNT' })
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('rejects an array or scalar masquerading as a destination', async () => {
      await expect(createWithdrawalRequest({ ...base, accountDetail: '["411111111111"]' as unknown as string }))
        .rejects.toMatchObject({ code: 'INVALID_ACCOUNT' })
    })

    it('rejects an unpayable IFSC rather than holding the balance for a payout finance cannot make', async () => {
      await expect(
        createWithdrawalRequest({ ...base, accountDetail: { accountNumber: '411111111111', ifsc: 'NOT-AN-IFSC' } })
      ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' })
      expect(mocks.walletUpdate).not.toHaveBeenCalled()
    })

    it('rejects a non-string account number instead of coercing it', async () => {
      await expect(
        createWithdrawalRequest({ ...base, accountDetail: { accountNumber: 411111111111, ifsc: 'HDFC0000123' } })
      ).rejects.toMatchObject({ code: 'INVALID_ACCOUNT' })
    })

    it('returns the amount as a number so the agent does not print a Decimal string', async () => {
      const result = await createWithdrawalRequest({
        ...base,
        accountDetail: { accountNumber: '411111111111', ifsc: 'HDFC0000123' },
      })

      expect(typeof result.amount).toBe('number')
    })
  })
})
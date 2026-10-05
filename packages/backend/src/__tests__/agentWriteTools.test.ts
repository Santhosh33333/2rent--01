import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Security and correctness tests for the mutating agent tools.
 *
 * The confirmation gate itself is covered in agentTools.test.ts. What matters
 * here is everything that gate depends on: that no write happens without an
 * exact-match token, that the signed-in user comes from the context rather than
 * the arguments, that ownership is re-checked at execution time, and that the
 * price comes from the server estimate rather than from the model.
 */

const mocks = vi.hoisted(() => ({
  requestCreate: vi.fn(),
  requestFindUnique: vi.fn(),
  requestUpdate: vi.fn(),
  eventFindUnique: vi.fn(),
  eventUpdateMany: vi.fn(),
  attendeeFindUnique: vi.fn(),
  attendeeCreate: vi.fn(),
  userFindUnique: vi.fn(),
  reportCount: vi.fn(),
  reportCreate: vi.fn(),
  verificationFindUnique: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock('../config/database', () => ({
  prisma: {
    walkingRequest: {
      create: mocks.requestCreate,
      findUnique: mocks.requestFindUnique,
      update: mocks.requestUpdate,
    },
    event: { findUnique: mocks.eventFindUnique, updateMany: mocks.eventUpdateMany },
    eventAttendee: { findUnique: mocks.attendeeFindUnique, create: mocks.attendeeCreate },
    user: { findUnique: mocks.userFindUnique },
    report: { count: mocks.reportCount, create: mocks.reportCreate },
    verification: { findUnique: mocks.verificationFindUnique },
    $transaction: mocks.transaction,
  },
}))

import { runAgentTool, __resetConfirmationsForTests, setAuditSink } from '../agent/toolRouter'
import type { AgentAuditRow } from '../agent/toolRouter'
import type { AgentToolContext } from '../agent/toolRegistry'
import '../agent/tools/writeTools'

const UUID_A = '11111111-1111-4111-8111-111111111111'
const UUID_B = '22222222-2222-4222-8222-222222222222'

function ctx(overrides: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    userId: 'user-1',
    role: 'USER',
    accountRole: 'USER',
    isAdminTier: false,
    sessionId: 'sess-1',
    ...overrides,
  }
}

const APPROVED = {
  name: 'walking-partner',
  fullName: 'Walking Partner',
  providesWalking: true,
  rating: 4.8,
  averageRating: 4.8,
  completedJobs: 12,
}

const EVENT = {
  id: UUID_A,
  title: 'Sunrise Walk',
  status: 'PUBLISHED',
  capacity: 3,
  attendeeCount: 1,
  startTime: new Date(Date.now() + 86_400_000),
}

function auditCapture() {
  const rows: AgentAuditRow[] = [];
  setAuditSink((row) => {
    rows.push(row);
  });
  return rows;
}

/** A confirmation token issued by the router for exactly these arguments. */
async function tokenFor(
  toolName: string,
  args: unknown,
  context: AgentToolContext = ctx()
): Promise<string> {
  const outcome = await runAgentTool(context, { toolName, args });
  expect(outcome.status).toBe('confirmation_required');
  if (outcome.status !== 'confirmation_required') throw new Error('expected confirmation_required');
  return outcome.confirmation.token;
}

describe('write tools: confirmation is mandatory', () => {
  beforeEach(() => {
    __resetConfirmationsForTests();
    vi.clearAllMocks();
    auditCapture();
    mocks.verificationFindUnique.mockResolvedValue({ status: 'VERIFIED', trialEndsAt: null });
    mocks.requestCreate.mockResolvedValue({
      id: UUID_B,
      status: 'OPEN',
      startTime: new Date(Date.now() + 86_400_000),
      fare: 150,
    });
    mocks.requestUpdate.mockResolvedValue({});
    mocks.requestFindUnique.mockResolvedValue({
      id: UUID_B,
      status: 'OPEN',
      requesterId: 'user-1',
      startLocation: 'A',
      endLocation: 'B',
    });
    mocks.eventFindUnique.mockResolvedValue(EVENT);
    mocks.eventUpdateMany.mockResolvedValue({ count: 1 });
    mocks.attendeeFindUnique.mockResolvedValue(null);
    mocks.attendeeCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(prismaTx));
    mocks.userFindUnique.mockResolvedValue({ id: UUID_B, fullName: APPROVED.name });
    mocks.reportCount.mockResolvedValue(0);
    mocks.reportCreate.mockResolvedValue({
      id: 'rep-1',
      status: 'PENDING',
      createdAt: new Date(),
    });
  });

  describe('create_walking_request', () => {
    const args = {
      startLocation: 'Marina Beach',
      endLocation: 'ECIL',
      startTime: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 60,
    };

    it('does not create anything without a confirmation token', async () => {
      const outcome = await runAgentTool(ctx(), { toolName: 'create_walking_request', args });

      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })

    it('creates only when a matching token is supplied', async () => {
      const token = await tokenFor('create_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('success')
      expect(mocks.requestCreate).toHaveBeenCalledTimes(1)
    })

    it('rejects a token issued for different arguments', async () => {
      const token = await tokenFor('create_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args: { ...args, endLocation: 'Somewhere Else Entirely' },
        confirmationToken: token,
      })

      expect(outcome.status).toBe('denied')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })

    it('takes the requester from the session, not from the arguments', async () => {
      const token = await tokenFor('create_walking_request', args)
      await runAgentTool(ctx(), { toolName: 'create_walking_request', args, confirmationToken: token })

      const payload = mocks.requestCreate.mock.calls[0][0].data
      expect(payload.requesterId).toBe('user-1')
      // requesterId is not part of the tool schema, so it cannot be injected.
      expect(args).not.toHaveProperty('requesterId')
    })

    it('refuses a start time in the past', async () => {
      const past = {
        ...args,
        startTime: new Date(Date.now() - 3_600_000).toISOString(),
      }
      const token = await tokenFor('create_walking_request', past)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args: past,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })

    it('derives the fare from the server estimate when the model proposes none', async () => {
      const token = await tokenFor('create_walking_request', args)
      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('success')
      // The real pricing engine ran: resolveWalkingFare is not mocked, so this is
      // the server's number for a 60 minute walk, not anything the caller chose.
      const usedFare = mocks.requestCreate.mock.calls[0][0].data.fare
      expect(typeof usedFare).toBe('number')
      expect(usedFare).toBeGreaterThan(0)
    })

    it('rejects a model-proposed fare outside the server estimate band', async () => {
      const greedy = { ...args, fare: 5000 }
      const token = await tokenFor('create_walking_request', greedy)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args: greedy,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('INVALID_FARE')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })

    it('refuses a fare above the schema ceiling before any confirmation is offered', async () => {
      const absurd = { ...args, fare: 999999 }
      const outcome = await runAgentTool(ctx(), { toolName: 'create_walking_request', args: absurd })

      // Rejected by argument validation, so no token is ever issued for it.
      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('TOOL_BAD_INPUT')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })

    it('refuses to create when KYC is not approved', async () => {
      mocks.verificationFindUnique.mockResolvedValue({ status: 'PENDING_REVIEW', trialEndsAt: null })
      const token = await tokenFor('create_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'create_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('KYC_PENDING')
      expect(mocks.requestCreate).not.toHaveBeenCalled()
    })
  })

  describe('cancel_walking_request', () => {
    const args = { requestId: UUID_B }

    it('does not cancel without a token', async () => {
      const outcome = await runAgentTool(ctx(), { toolName: 'cancel_walking_request', args })
      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.requestUpdate).not.toHaveBeenCalled()
    })

    it('refuses to cancel a request owned by someone else', async () => {
      mocks.requestFindUnique.mockResolvedValue({
        id: UUID_B,
        status: 'OPEN',
        requesterId: 'someone-else',
        startLocation: 'A',
        endLocation: 'B',
      })
      const token = await tokenFor('cancel_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'cancel_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('FORBIDDEN')
      expect(mocks.requestUpdate).not.toHaveBeenCalled()
    })

    it('refuses to cancel a completed request', async () => {
      mocks.requestFindUnique.mockResolvedValue({
        id: UUID_B,
        status: 'COMPLETED',
        requesterId: 'user-1',
        startLocation: 'A',
        endLocation: 'B',
      })
      const token = await tokenFor('cancel_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'cancel_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      expect(mocks.requestUpdate).not.toHaveBeenCalled()
    })

    it('treats an already-cancelled request as a no-op instead of writing again', async () => {
      mocks.requestFindUnique.mockResolvedValue({
        id: UUID_B,
        status: 'CANCELLED',
        requesterId: 'user-1',
        startLocation: 'A',
        endLocation: 'B',
      })
      const token = await tokenFor('cancel_walking_request', args)

      const outcome = await runAgentTool(ctx(), {
        toolName: 'cancel_walking_request',
        args,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('success')
      if (outcome.status !== 'success') throw new Error('expected success')
      expect((outcome.data as { alreadyCancelled: boolean }).alreadyCancelled).toBe(true)
      expect(mocks.requestUpdate).not.toHaveBeenCalled()
    })
  })

  describe('join_event', () => {
    const args = { eventId: UUID_A }

    it('does not register without a token', async () => {
      const outcome = await runAgentTool(ctx(), { toolName: 'join_event', args })
      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.attendeeCreate).not.toHaveBeenCalled()
    })

    it('registers with a matching token', async () => {
      const token = await tokenFor('join_event', args)
      const outcome = await runAgentTool(ctx(), { toolName: 'join_event', args, confirmationToken: token })

      expect(outcome.status).toBe('success')
      expect(mocks.attendeeCreate).toHaveBeenCalledTimes(1)
    })

    it('does not overbook a full event', async () => {
      mocks.eventUpdateMany.mockResolvedValue({ count: 0 })
      const token = await tokenFor('join_event', args)

      const outcome = await runAgentTool(ctx(), { toolName: 'join_event', args, confirmationToken: token })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('EVENT_FULL')
      expect(mocks.attendeeCreate).not.toHaveBeenCalled()
    })

    it('refuses to register the same user twice', async () => {
      mocks.attendeeFindUnique.mockResolvedValue({ id: 'att-1' })
      const token = await tokenFor('join_event', args)

      const outcome = await runAgentTool(ctx(), { toolName: 'join_event', args, confirmationToken: token })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('ALREADY_REGISTERED')
      expect(mocks.attendeeCreate).not.toHaveBeenCalled()
    })

    it('refuses a cancelled event', async () => {
      mocks.eventFindUnique.mockResolvedValue({ ...EVENT, status: 'CANCELLED' })
      const token = await tokenFor('join_event', args)

      const outcome = await runAgentTool(ctx(), { toolName: 'join_event', args, confirmationToken: token })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('EVENT_CANCELLED')
    })
  })

  describe('report_user', () => {
    const args = { targetUserId: UUID_B, reason: 'HARASSMENT' as const }

    it('does not file a report without a token', async () => {
      const outcome = await runAgentTool(ctx(), { toolName: 'report_user', args })
      expect(outcome.status).toBe('confirmation_required')
      expect(mocks.reportCreate).not.toHaveBeenCalled()
    })

    it('files the report with a matching token, attributed to the session user', async () => {
      const token = await tokenFor('report_user', args)
      const outcome = await runAgentTool(ctx(), { toolName: 'report_user', args, confirmationToken: token })

      expect(outcome.status).toBe('success')
      expect(mocks.reportCreate.mock.calls[0][0].data.reporterId).toBe('user-1')
    })

    it('refuses a self-report', async () => {
      // targetUserId must be a UUID to pass the schema, so the session user is
      // given one too; otherwise this would fail validation instead of reaching
      // the self-report guard.
      const selfCtx = ctx({ userId: UUID_A })
      const selfArgs = { targetUserId: UUID_A, reason: 'OTHER' as const }
      const token = await tokenFor('report_user', selfArgs, selfCtx)

      const outcome = await runAgentTool(selfCtx, {
        toolName: 'report_user',
        args: selfArgs,
        confirmationToken: token,
      })

      expect(outcome.status).toBe('failed')
      if (outcome.status !== 'failed') throw new Error('expected failed')
      expect(outcome.code).toBe('INVALID_TARGET')
      expect(mocks.reportCreate).not.toHaveBeenCalled()
    })
  })

  it('audits every mutating attempt, including the unconfirmed ones', async () => {
    const rows = auditCapture()
    await runAgentTool(ctx(), { toolName: 'create_walking_request', args: { startLocation: 'A' } })

    expect(rows.length).toBeGreaterThan(0)
    expect(rows.at(-1)!.toolName).toBe('create_walking_request')
  })
})

/** Minimal transaction client matching the methods the tool uses. */
const prismaTx = {
  eventAttendee: {
    findUnique: mocks.attendeeFindUnique,
    create: mocks.attendeeCreate,
  },
  event: { updateMany: mocks.eventUpdateMany },
}
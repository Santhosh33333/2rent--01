import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Hard-deleting a User cascades to their Events (Event.organizer is onDelete:
 * Cascade) and so to EventEscrow, and settlement is the only code that ever
 * un-holds a payer's wallet. So an admin deleting an organizer who still has
 * HELD or DISPUTED escrow would strand every payer's reserved balance with no
 * row left to refund. Both admin delete paths now refuse on that and say so,
 * while a suspend or an account with nothing held is untouched.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), delete: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  eventEscrow: { count: vi.fn() },
  auditLog: { create: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
// adminController pulls in ../config/env, which otherwise validates process.env
// and throws when the suite has not set one up.
vi.mock('../config/env', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-secret',
    SUPER_ADMIN_EMAIL: '',
  },
}));

import { deleteUser, bulkUserAction } from '../controllers/adminController';

const ADMIN = 'admin-1';
const TARGET = 'user-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findUnique.mockResolvedValue({ email: 'target@example.com' });
  prismaMock.user.delete.mockResolvedValue({});
  prismaMock.user.update.mockResolvedValue({});
  prismaMock.user.findMany.mockResolvedValue([
    { id: TARGET, email: 'target@example.com', fullName: 'Target' },
  ]);
  prismaMock.eventEscrow.count.mockResolvedValue(0);
  prismaMock.auditLog.create.mockResolvedValue({});
});

describe('deleteUser — held event money guard', () => {
  const req = () => ({ params: { id: TARGET }, user: { userId: ADMIN } }) as any;

  it('refuses when the account still organizes unsettled escrow', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(3);

    const res = makeRes();
    await deleteUser(req(), res);

    expect(res.status).toHaveBeenCalledWith(409);
    const payload = body(res);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('USER_HAS_UNSETTLED_EVENT_ESCROW');
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
    // The audit row is written after the guard, so a refused delete leaves none.
    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
  });

  it('deletes an account with nothing held', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(0);

    const res = makeRes();
    await deleteUser(req(), res);

    expect(body(res).success).toBe(true);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
  });
});

describe('bulkUserAction — held event money guard', () => {
  const deleteReq = () =>
    ({ body: { action: 'delete', userIds: [TARGET] }, user: { userId: ADMIN } }) as any;

  it('skips a delete that would strand held money, and reports why', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(1);

    const res = makeRes();
    await bulkUserAction(deleteReq(), res);

    const payload = body(res);
    expect(payload.success).toBe(true);
    expect(payload.data.skippedCount).toBe(1);
    expect(payload.data.succeededCount).toBe(0);
    expect(payload.data.skipped[0].reason).toMatch(/holds attendees' money/i);
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('deletes the account when nothing is held', async () => {
    prismaMock.eventEscrow.count.mockResolvedValue(0);

    const res = makeRes();
    await bulkUserAction(deleteReq(), res);

    const payload = body(res);
    expect(payload.data.succeededCount).toBe(1);
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
  });

  it('never checks escrow for a suspend (the reversible action)', async () => {
    const res = makeRes();
    await bulkUserAction(
      { body: { action: 'suspend', userIds: [TARGET] }, user: { userId: ADMIN } } as any,
      res,
    );

    expect(prismaMock.eventEscrow.count).not.toHaveBeenCalled();
    expect(body(res).data.succeededCount).toBe(1);
  });
});

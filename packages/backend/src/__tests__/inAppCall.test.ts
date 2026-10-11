import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUserBlockFindFirst, mockUserFindUnique, mockCallCreate, mockCallUpdate } =
  vi.hoisted(() => ({
    mockUserBlockFindFirst: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockCallCreate: vi.fn(),
    mockCallUpdate: vi.fn(),
  }));

vi.mock('../config/database', () => ({
  prisma: {
    userBlock: { findFirst: mockUserBlockFindFirst },
    user: { findUnique: mockUserFindUnique },
    callLog: { create: mockCallCreate, update: mockCallUpdate },
  },
}));

vi.mock('../services/notificationService', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

import { canCall, registerCallHandlers } from '../services/callService';

const ME = 'user-me';
const THEM = 'user-them';

// Any member may be called; only a block or a missing account refuses.
function allowCall() {
  mockUserBlockFindFirst.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue({ id: THEM });
}
function blockCall() {
  mockUserBlockFindFirst.mockResolvedValue({ id: 'block-1' });
  mockUserFindUnique.mockResolvedValue({ id: THEM });
}
function missingTarget() {
  mockUserBlockFindFirst.mockResolvedValue(null);
  mockUserFindUnique.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  allowCall();
  // Prisma always returns a thenable; mirror that so awaited .catch() works.
  mockCallUpdate.mockResolvedValue({});
  mockCallCreate.mockResolvedValue({ id: 'call-x' });
});

describe('in-app call authorization', () => {
  it('never lets a member call themselves', async () => {
    const result = await canCall(ME, ME);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SELF_CALL');
    // No lookups are needed for a self-call.
    expect(mockUserBlockFindFirst).not.toHaveBeenCalled();
  });

  it('allows a call to any other member with no block between them', async () => {
    allowCall();
    const result = await canCall(ME, THEM);
    expect(result.allowed).toBe(true);
  });

  it('refuses a call when either side has blocked the other', async () => {
    blockCall();
    const result = await canCall(ME, THEM);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('FORBIDDEN');
  });

  it('refuses a call to an account that does not exist', async () => {
    missingTarget();
    const result = await canCall(ME, 'ghost');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_RECEIVER');
  });

  it('checks the block in both directions', async () => {
    blockCall();
    await canCall(ME, THEM);
    const where = mockUserBlockFindFirst.mock.calls[0][0].where.OR;
    expect(where).toHaveLength(2);
    expect(JSON.stringify(where)).toContain(ME);
    expect(JSON.stringify(where)).toContain(THEM);
  });

  it('never queries a phone number while authorizing a call', async () => {
    allowCall();
    await canCall(ME, THEM);
    const serialized = JSON.stringify(mockUserFindUnique.mock.calls);
    expect(serialized).not.toContain('phone');
  });
});

describe('call signaling payloads', () => {
  it('builds the peer identity from id, name and avatar only', async () => {
    mockUserFindUnique.mockResolvedValue({
      id: THEM,
      fullName: 'Asha',
      avatarUrl: '/avatars/asha.png',
      // A phone number exists in the database but must never be selected.
      phone: '+919999999999',
    });
    mockUserBlockFindFirst.mockResolvedValue(null);

    // The invite path resolves the caller's identity; verify the select set.
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    const io: any = {};
    const emitToUser = vi.fn();

    registerCallHandlers(io, socket, ME, emitToUser, () => false);

    mockCallCreate.mockResolvedValue({ id: 'call-1' });
    handlers['call:invite']({ receiverId: THEM, type: 'VOICE' });
    await vi.waitFor(() => expect(mockCallCreate).toHaveBeenCalled());

    // canCall also looks the target up (select id only); the peer-identity
    // lookups are the ones that select the display fields.
    const identityCall = mockUserFindUnique.mock.calls.find(
      (call) => (call[0]?.select as { fullName?: boolean } | undefined)?.fullName === true
    );
    expect(identityCall?.[0].select).toEqual({
      id: true,
      fullName: true,
      avatarUrl: true,
    });

    // The peer payload that rings the callee carries no phone number.
    const incoming = emitToUser.mock.calls.find((call) => call[1] === 'call:incoming');
    expect(incoming).toBeDefined();
    expect(JSON.stringify(incoming![2])).not.toContain('9999999999');
    expect(incoming![2].peer).toMatchObject({ id: ME });

    // The ledger row starts as RINGING, not a pre-baked MISSED.
    expect(mockCallCreate.mock.calls[0][0].data).toMatchObject({ status: 'RINGING' });
  });

  it('refuses to ring a member who has blocked the caller and never creates a row', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    const emitToUser = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToUser, () => false);

    blockCall();
    handlers['call:invite']({ receiverId: THEM });
    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalled());

    expect(mockCallCreate).not.toHaveBeenCalled();
    const unavailable = socket.emit.mock.calls.find((call) => call[0] === 'call:unavailable');
    expect(unavailable?.[1]).toMatchObject({ reason: 'FORBIDDEN' });
  });

  it('rejects a self-call invite before touching the database', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    registerCallHandlers({} as any, socket, ME, vi.fn(), () => false);

    handlers['call:invite']({ receiverId: ME });
    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalled());

    expect(mockCallCreate).not.toHaveBeenCalled();
    expect(socket.emit.mock.calls[0][1]).toMatchObject({ reason: 'SELF_CALL' });
  });

  it('only relays WebRTC signaling to the other participant', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    const emitToUser = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToUser, () => true);

    // No live call exists, so a stray offer must not be forwarded anywhere.
    handlers['call:offer']({ callId: 'unknown-call', payload: { type: 'offer', sdp: 'x' } });
    expect(emitToUser).not.toHaveBeenCalled();
  });

  it('cancels a previous ringing call when the same user rings again', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    const emitToUser = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToUser, () => true);

    allowCall();
    mockCallCreate.mockResolvedValueOnce({ id: 'call-1' }).mockResolvedValueOnce({ id: 'call-2' });
    mockUserFindUnique.mockResolvedValue({ id: THEM, fullName: 'Asha', avatarUrl: null });

    handlers['call:invite']({ receiverId: THEM, type: 'VOICE' });
    await vi.waitFor(() => expect(mockCallCreate).toHaveBeenCalledTimes(1));
    handlers['call:invite']({ receiverId: THEM, type: 'VOICE' });
    await vi.waitFor(() => expect(mockCallCreate).toHaveBeenCalledTimes(2));

    // The superseded call is closed so the peer is not left ringing.
    const replaced = emitToUser.mock.calls.find((call) => call[2]?.reason === 'REPLACED');
    expect(replaced).toBeDefined();
    expect(mockCallUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'call-1' }, data: expect.objectContaining({ status: 'CANCELLED' }) })
    );
  });
});

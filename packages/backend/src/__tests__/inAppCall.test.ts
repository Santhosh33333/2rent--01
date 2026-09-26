import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBookingFindFirst, mockConversationFindFirst, mockFriendshipFindFirst, mockUserFindUnique, mockCallCreate, mockCallUpdate } =
  vi.hoisted(() => ({
    mockBookingFindFirst: vi.fn(),
    mockConversationFindFirst: vi.fn(),
    mockFriendshipFindFirst: vi.fn(),
    mockUserFindUnique: vi.fn(),
    mockCallCreate: vi.fn(),
    mockCallUpdate: vi.fn(),
  }));

vi.mock('../config/database', () => ({
  prisma: {
    booking: { findFirst: mockBookingFindFirst },
    conversation: { findFirst: mockConversationFindFirst },
    friendship: { findFirst: mockFriendshipFindFirst },
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

function allowBooking() {
  mockBookingFindFirst.mockResolvedValue({ id: 'b-1' });
  mockConversationFindFirst.mockResolvedValue(null);
  mockFriendshipFindFirst.mockResolvedValue(null);
}
function allowConversation() {
  mockBookingFindFirst.mockResolvedValue(null);
  mockConversationFindFirst.mockResolvedValue({ id: 'c-1' });
  mockFriendshipFindFirst.mockResolvedValue(null);
}
function allowFriendship() {
  mockBookingFindFirst.mockResolvedValue(null);
  mockConversationFindFirst.mockResolvedValue(null);
  mockFriendshipFindFirst.mockResolvedValue({ id: 'f-1' });
}
function allowNone() {
  mockBookingFindFirst.mockResolvedValue(null);
  mockConversationFindFirst.mockResolvedValue(null);
  mockFriendshipFindFirst.mockResolvedValue(null);
}

beforeEach(() => {
  vi.clearAllMocks();
  allowNone();
  // Prisma always returns a thenable; mirror that so awaited .catch() works.
  mockCallUpdate.mockResolvedValue({});
  mockCallCreate.mockResolvedValue({ id: 'call-x' });
});

describe('in-app call authorization', () => {
  it('never lets a member call themselves', async () => {
    const result = await canCall(ME, ME);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('SELF_CALL');
    // No relationship lookups are needed for a self-call.
    expect(mockBookingFindFirst).not.toHaveBeenCalled();
  });

  it('allows a call when the two share a booking', async () => {
    allowBooking();
    const result = await canCall(ME, THEM);
    expect(result.allowed).toBe(true);
  });

  it('allows a call when a conversation already exists', async () => {
    allowConversation();
    const result = await canCall(ME, THEM);
    expect(result.allowed).toBe(true);
  });

  it('allows a call between accepted friends', async () => {
    allowFriendship();
    const result = await canCall(ME, THEM);
    expect(result.allowed).toBe(true);
  });

  it('blocks cold-calling a stranger', async () => {
    const result = await canCall(ME, 'random-stranger');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('NO_RELATIONSHIP');
  });

  it('checks friendship in both directions (either party may have asked)', async () => {
    allowFriendship();
    await canCall(THEM, ME);
    const where = mockFriendshipFindFirst.mock.calls[0][0].where.OR;
    expect(where).toHaveLength(2);
    expect(JSON.stringify(where)).toContain(ME);
    expect(JSON.stringify(where)).toContain(THEM);
  });

  it('never queries a phone number while authorizing a call', async () => {
    allowNone();
    await canCall(ME, THEM);
    const allQueries = [
      ...mockBookingFindFirst.mock.calls,
      ...mockConversationFindFirst.mock.calls,
      ...mockFriendshipFindFirst.mock.calls,
    ];
    const serialized = JSON.stringify(allQueries);
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
    allowConversation();
    handlers['call:invite']({ receiverId: THEM, type: 'VOICE' });
    await vi.waitFor(() => expect(mockCallCreate).toHaveBeenCalled());

    expect(mockUserFindUnique.mock.calls[0][0].select).toEqual({
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

  it('refuses to start a call to a stranger and never creates a row', async () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const socket: any = {
      on: (event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      },
      emit: vi.fn(),
    };
    const emitToUser = vi.fn();
    registerCallHandlers({} as any, socket, ME, emitToUser, () => false);

    allowNone();
    handlers['call:invite']({ receiverId: 'stranger' });
    await vi.waitFor(() => expect(socket.emit).toHaveBeenCalled());

    expect(mockCallCreate).not.toHaveBeenCalled();
    const unavailable = socket.emit.mock.calls.find((call) => call[0] === 'call:unavailable');
    expect(unavailable?.[1]).toMatchObject({ reason: 'NO_RELATIONSHIP' });
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

    allowConversation();
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

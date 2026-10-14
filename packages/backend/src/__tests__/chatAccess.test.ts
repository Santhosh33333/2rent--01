import { describe, it, expect, vi, beforeEach } from 'vitest';

// canDirectChat is the single gate both send paths and the UI share, so it is
// tested against its own small prisma surface rather than through a controller.
const prismaMock = vi.hoisted(() => ({
  conversation: { findUnique: vi.fn() },
  chatRequest: { findFirst: vi.fn() },
  friendship: { findFirst: vi.fn() },
  match: { findFirst: vi.fn() },
  booking: { findFirst: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));

import { canDirectChat } from '../services/chatAccess';

const A = 'user-a';
const B = 'user-b';

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.conversation.findUnique.mockResolvedValue(null);
  prismaMock.chatRequest.findFirst.mockResolvedValue(null);
  prismaMock.friendship.findFirst.mockResolvedValue(null);
  prismaMock.match.findFirst.mockResolvedValue(null);
  prismaMock.booking.findFirst.mockResolvedValue(null);
});

describe('canDirectChat', () => {
  it('refuses a first contact with no mutual yes', async () => {
    const r = await canDirectChat(A, B);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('NOT_CONNECTED');
  });

  it('refuses messaging yourself', async () => {
    const r = await canDirectChat(A, A);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('SELF');
  });

  it('allows an accepted chat request', async () => {
    prismaMock.chatRequest.findFirst.mockResolvedValue({ id: 'r1' });
    expect((await canDirectChat(A, B)).allowed).toBe(true);
  });

  it('allows an accepted friendship', async () => {
    prismaMock.friendship.findFirst.mockResolvedValue({ id: 'f1' });
    expect((await canDirectChat(A, B)).allowed).toBe(true);
  });

  it('allows an active dating match', async () => {
    prismaMock.match.findFirst.mockResolvedValue({ id: 'm1' });
    expect((await canDirectChat(A, B)).allowed).toBe(true);
  });

  it('allows a shared booking', async () => {
    prismaMock.booking.findFirst.mockResolvedValue({ id: 'b1' });
    expect((await canDirectChat(A, B)).allowed).toBe(true);
  });

  it('allows a thread that already has messages', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', _count: { messages: 2 } });
    expect((await canDirectChat(A, B)).allowed).toBe(true);
  });

  it('does not treat an empty conversation row as a connection', async () => {
    prismaMock.conversation.findUnique.mockResolvedValue({ id: 'c1', _count: { messages: 0 } });
    expect((await canDirectChat(A, B)).allowed).toBe(false);
  });

  it('lets admin-tier accounts message anyone, without a lookup', async () => {
    expect((await canDirectChat(A, B, 'SUPER_ADMIN')).allowed).toBe(true);
    expect((await canDirectChat(A, B, 'SUPPORT')).allowed).toBe(true);
    expect(prismaMock.conversation.findUnique).not.toHaveBeenCalled();
  });

  it('does not exempt ordinary members', async () => {
    expect((await canDirectChat(A, B, 'USER')).allowed).toBe(false);
    expect((await canDirectChat(A, B, 'PARTNER')).allowed).toBe(false);
  });
});

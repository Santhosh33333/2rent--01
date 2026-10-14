import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma surface the music-room controller touches. vi.mock factories
// are hoisted, so the mock object itself is hoisted with them.
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  musicRoom: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  musicRoomMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
vi.mock('../services/socketService', () => ({ emitToMusicRoom: vi.fn() }));

import {
  createRoom,
  joinRoom,
  leaveRoom,
  endRoom,
  setRoomMedia,
  addMembers,
} from '../controllers/musicRoomController';
import { emitToMusicRoom } from '../services/socketService';

const ME = 'user-me';
const ROOM = 'room-1';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function makeReq(opts: { body?: Record<string, unknown>; params?: Record<string, string>; userId?: string } = {}) {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    user: { userId: opts.userId ?? ME },
  } as any;
}
function statusOf(res: any) {
  return res.status.mock.calls[res.status.mock.calls.length - 1][0];
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

function room(extra: Record<string, unknown> = {}) {
  return {
    id: ROOM,
    code: 'ABC234',
    name: 'Chill',
    hostId: ME,
    isActive: true,
    mediaKind: 'AUDIO',
    mediaUrl: null,
    mediaTitle: null,
    isPlaying: false,
    positionSec: 0,
    version: 0,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...extra,
  };
}
// The shape findMembership() returns: role plus the room fields it selects.
function membership(role = 'HOST', extra: Record<string, unknown> = {}) {
  return { role, room: { id: ROOM, name: 'Chill', isActive: true, hostId: ME, ...extra } };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no code clash while generating a room code.
  prismaMock.musicRoom.findUnique.mockResolvedValue(null);
  prismaMock.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
});

describe('createRoom', () => {
  it('rejects an empty name', async () => {
    const res = makeRes();
    await createRoom(makeReq({ body: { name: '   ' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(body(res).success).toBe(false);
  });

  it('refuses a YouTube link so a room never promises a sync it cannot keep', async () => {
    const res = makeRes();
    await createRoom(makeReq({ body: { name: 'Party', mediaUrl: 'https://youtu.be/abc' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(body(res).error).toBe('INVALID_MEDIA');
    expect(body(res).message).toMatch(/YouTube/i);
    expect(prismaMock.musicRoom.create).not.toHaveBeenCalled();
  });

  it('creates the room with the host as its first, HOST member', async () => {
    prismaMock.musicRoom.create.mockResolvedValue(room({ mediaUrl: '/audio/ta/a.mp3', mediaKind: 'AUDIO' }));
    const res = makeRes();
    await createRoom(makeReq({ body: { name: 'Chill', mediaUrl: '/audio/ta/a.mp3', mediaTitle: 'A' } }), res);

    expect(statusOf(res)).toBe(201);
    const arg = prismaMock.musicRoom.create.mock.calls[0][0];
    expect(arg.data.members.create).toEqual([{ userId: ME, role: 'HOST' }]);
    expect(arg.data.mediaUrl).toBe('/audio/ta/a.mp3');
    expect(arg.data.mediaKind).toBe('AUDIO');
    expect(body(res).data.myRole).toBe('HOST');
    expect(body(res).data.memberCount).toBe(1);
  });
});

describe('joinRoom', () => {
  it('404s on an unknown code', async () => {
    prismaMock.musicRoom.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await joinRoom(makeReq({ body: { code: 'nope' } }), res);
    expect(statusOf(res)).toBe(404);
  });

  it('joins an open room', async () => {
    prismaMock.musicRoom.findUnique.mockResolvedValue(room({ _count: { members: 2 } }));
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(null);
    prismaMock.musicRoomMember.upsert.mockResolvedValue({});
    const res = makeRes();
    await joinRoom(makeReq({ body: { code: 'abc234' }, userId: 'guest-1' }), res);
    expect(statusOf(res)).toBe(200);
    expect(body(res).data.roomId).toBe(ROOM);
    expect(prismaMock.musicRoomMember.upsert).toHaveBeenCalled();
  });

  it('refuses a full room', async () => {
    prismaMock.musicRoom.findUnique.mockResolvedValue(room({ _count: { members: 50 } }));
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(null);
    const res = makeRes();
    await joinRoom(makeReq({ body: { code: 'abc234' }, userId: 'guest-1' }), res);
    expect(statusOf(res)).toBe(409);
    expect(prismaMock.musicRoomMember.upsert).not.toHaveBeenCalled();
  });
});

describe('leaveRoom', () => {
  it('ends the room when the last member leaves', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoomMember.findMany.mockResolvedValue([]);
    prismaMock.musicRoom.update.mockResolvedValue(room({ isActive: false }));
    const res = makeRes();
    await leaveRoom(makeReq({ params: { id: ROOM } }), res);
    expect(statusOf(res)).toBe(200);
    expect(body(res).data.ended).toBe(true);
    expect(prismaMock.musicRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) })
    );
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_ended', expect.anything());
  });

  it('hands the controls to a remaining guest when the host leaves', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoomMember.findMany.mockResolvedValue([{ userId: 'guest-1' }]);
    prismaMock.musicRoomMember.delete.mockResolvedValue({});
    prismaMock.musicRoomMember.update.mockResolvedValue({});
    prismaMock.musicRoom.update.mockResolvedValue(room({ hostId: 'guest-1' }));
    const res = makeRes();
    await leaveRoom(makeReq({ params: { id: ROOM } }), res);

    expect(prismaMock.musicRoomMember.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { role: 'HOST' } })
    );
    expect(prismaMock.musicRoom.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hostId: 'guest-1' } })
    );
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_host_changed', { roomId: ROOM, hostId: 'guest-1' });
  });
});

describe('endRoom', () => {
  it('forbids a non-host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('GUEST'));
    const res = makeRes();
    await endRoom(makeReq({ params: { id: ROOM } }), res);
    expect(statusOf(res)).toBe(403);
  });

  it('lets the host end it', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoom.update.mockResolvedValue(room({ isActive: false }));
    const res = makeRes();
    await endRoom(makeReq({ params: { id: ROOM } }), res);
    expect(statusOf(res)).toBe(200);
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_ended', { roomId: ROOM });
  });
});

describe('setRoomMedia', () => {
  it('forbids a non-host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('GUEST'));
    const res = makeRes();
    await setRoomMedia(makeReq({ params: { id: ROOM }, body: { mediaUrl: '/audio/x.mp3' } }), res);
    expect(statusOf(res)).toBe(403);
  });

  it('refuses a YouTube link', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    const res = makeRes();
    await setRoomMedia(makeReq({ params: { id: ROOM }, body: { mediaUrl: 'https://youtube.com/watch?v=1' } }), res);
    expect(statusOf(res)).toBe(400);
    expect(body(res).error).toBe('INVALID_MEDIA');
  });

  it('resets playback and broadcasts the new track', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoom.update.mockResolvedValue(
      room({ mediaUrl: '/audio/ta/b.mp3', mediaKind: 'AUDIO', mediaTitle: 'B', version: 1 })
    );
    const res = makeRes();
    await setRoomMedia(makeReq({ params: { id: ROOM }, body: { mediaUrl: '/audio/ta/b.mp3', mediaTitle: 'B' } }), res);

    expect(statusOf(res)).toBe(200);
    const arg = prismaMock.musicRoom.update.mock.calls[0][0];
    expect(arg.data.positionSec).toBe(0);
    expect(arg.data.isPlaying).toBe(false);
    expect(arg.data.version).toEqual({ increment: 1 });
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_sync', expect.objectContaining({ mediaUrl: '/audio/ta/b.mp3' }));
  });
});

describe('addMembers', () => {
  it('forbids a non-host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('GUEST'));
    const res = makeRes();
    await addMembers(makeReq({ params: { id: ROOM }, body: { userIds: ['u2'] } }), res);
    expect(statusOf(res)).toBe(403);
  });

  it('adds selected users for the host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.user.findMany.mockResolvedValue([{ id: 'u2' }]);
    prismaMock.musicRoomMember.upsert.mockResolvedValue({});
    prismaMock.musicRoomMember.count.mockResolvedValue(3);
    const res = makeRes();
    await addMembers(makeReq({ params: { id: ROOM }, body: { userIds: ['u2'] } }), res);
    expect(statusOf(res)).toBe(200);
    expect(body(res).data.memberCount).toBe(3);
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_presence', { roomId: ROOM, memberCount: 3 });
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma surface the music-room controller touches. vi.mock factories
// are hoisted, so the mock object itself is hoisted with them.
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  musicRoom: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
  musicRoomMember: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
  },
  uploadedFile: { delete: vi.fn() },
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
  uploadRoomMedia,
  getRoom,
  deleteRoom,
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
function makeReq(opts: {
  body?: Record<string, unknown>;
  params?: Record<string, string>;
  userId?: string;
  file?: unknown;
} = {}) {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    user: { userId: opts.userId ?? ME },
    file: opts.file,
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
  return {
    role,
    room: {
      id: ROOM,
      name: 'Chill',
      isActive: true,
      hostId: ME,
      mediaUrl: null,
      mediaExpiresAt: null,
      retentionDays: 0,
      ...extra,
    },
  };
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

  it('accepts a single YouTube video and stores it as a YOUTUBE track', async () => {
    prismaMock.musicRoom.create.mockResolvedValue(
      room({ mediaUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', mediaKind: 'YOUTUBE' })
    );
    const res = makeRes();
    await createRoom(makeReq({ body: { name: 'Party', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ' } }), res);
    expect(statusOf(res)).toBe(201);
    const arg = prismaMock.musicRoom.create.mock.calls[0][0];
    expect(arg.data.mediaKind).toBe('YOUTUBE');
    expect(arg.data.mediaUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });

  it('refuses a YouTube playlist, which cannot be synced', async () => {
    const res = makeRes();
    await createRoom(makeReq({ body: { name: 'Party', mediaUrl: 'https://www.youtube.com/playlist?list=PLabc' } }), res);
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

  it('refuses a YouTube playlist', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    const res = makeRes();
    await setRoomMedia(makeReq({ params: { id: ROOM }, body: { mediaUrl: 'https://www.youtube.com/playlist?list=PLabc' } }), res);
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

describe('uploadRoomMedia', () => {
  it('forbids a non-host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('GUEST'));
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({ params: { id: ROOM }, file: { filename: 'x.mp3', originalname: 'x.mp3' } }),
      res
    );
    expect(statusOf(res)).toBe(403);
    expect(prismaMock.musicRoom.update).not.toHaveBeenCalled();
  });

  it('requires a file', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    const res = makeRes();
    await uploadRoomMedia(makeReq({ params: { id: ROOM } }), res);
    expect(statusOf(res)).toBe(400);
    expect(prismaMock.musicRoom.update).not.toHaveBeenCalled();
  });

  it('stores an audio upload and broadcasts it', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoom.update.mockResolvedValue(
      room({ mediaUrl: '/uploads/abc.mp3', mediaKind: 'AUDIO', mediaTitle: 'My song', version: 2 })
    );
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({
        params: { id: ROOM },
        body: { title: 'My song' },
        file: { filename: 'abc.mp3', originalname: 'whatever-9f2.mp3' },
      }),
      res
    );

    expect(statusOf(res)).toBe(200);
    const arg = prismaMock.musicRoom.update.mock.calls[0][0];
    expect(arg.data.mediaUrl).toBe('/uploads/abc.mp3');
    expect(arg.data.mediaKind).toBe('AUDIO');
    expect(arg.data.mediaTitle).toBe('My song');
    expect(arg.data.positionSec).toBe(0);
    expect(arg.data.isPlaying).toBe(false);
    expect(emitToMusicRoom).toHaveBeenCalledWith(
      ROOM,
      'music_room_sync',
      expect.objectContaining({ mediaUrl: '/uploads/abc.mp3', mediaKind: 'AUDIO' })
    );
  });

  it('classifies a video upload as VIDEO and falls back to the file name for a title', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST'));
    prismaMock.musicRoom.update.mockResolvedValue(
      room({ mediaUrl: '/uploads/clip.mp4', mediaKind: 'VIDEO', mediaTitle: 'holiday', version: 3 })
    );
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({
        params: { id: ROOM },
        file: { filename: 'clip.mp4', originalname: 'holiday.mp4' },
      }),
      res
    );

    expect(statusOf(res)).toBe(200);
    const arg = prismaMock.musicRoom.update.mock.calls[0][0];
    expect(arg.data.mediaKind).toBe('VIDEO');
    expect(arg.data.mediaTitle).toBe('holiday');
  });
});

describe('music-room upload retention', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('gives an upload an expiry from the creator-chosen days', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST', { retentionDays: 7 }));
    prismaMock.musicRoom.update.mockResolvedValue(room({ mediaUrl: '/uploads/a.mp3', mediaKind: 'AUDIO' }));
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({ params: { id: ROOM }, file: { filename: 'a.mp3', originalname: 'a.mp3' } }),
      res
    );

    expect(statusOf(res)).toBe(200);
    const arg = prismaMock.musicRoom.update.mock.calls[0][0];
    const expiry = arg.data.mediaExpiresAt as Date;
    expect(expiry).toBeInstanceOf(Date);
    const days = (expiry.getTime() - Date.now()) / DAY;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);
  });

  it('keeps an upload with no expiry when retention is 0', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('HOST', { retentionDays: 0 }));
    prismaMock.musicRoom.update.mockResolvedValue(room({ mediaUrl: '/uploads/a.mp3', mediaKind: 'AUDIO' }));
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({ params: { id: ROOM }, file: { filename: 'a.mp3', originalname: 'a.mp3' } }),
      res
    );
    const arg = prismaMock.musicRoom.update.mock.calls[0][0];
    expect(arg.data.mediaExpiresAt).toBeNull();
  });

  it('deletes a replaced upload rather than orphaning its blob', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(
      membership('HOST', { mediaUrl: '/uploads/old.mp3' })
    );
    prismaMock.musicRoom.update.mockResolvedValue(room({ mediaUrl: '/uploads/new.mp3', mediaKind: 'AUDIO' }));
    const res = makeRes();
    await uploadRoomMedia(
      makeReq({ params: { id: ROOM }, file: { filename: 'new.mp3', originalname: 'new.mp3' } }),
      res
    );
    expect(prismaMock.uploadedFile.delete).toHaveBeenCalledWith({ where: { key: 'old.mp3' } });
  });

  it('clears an expired upload the next time the room is read', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(
      membership('HOST', { mediaUrl: '/uploads/gone.mp3', mediaExpiresAt: new Date(Date.now() - 1000) })
    );
    prismaMock.musicRoom.update.mockResolvedValue(room({ mediaUrl: null, mediaKind: 'AUDIO' }));
    prismaMock.musicRoom.findUnique.mockResolvedValue(
      room({
        mediaUrl: null,
        mediaKind: 'AUDIO',
        members: [],
        host: { id: ME, fullName: 'Me', avatarUrl: null },
        _count: { members: 1 },
      })
    );

    const res = makeRes();
    await getRoom(makeReq({ params: { id: ROOM } }), res);

    expect(statusOf(res)).toBe(200);
    expect(prismaMock.uploadedFile.delete).toHaveBeenCalledWith({ where: { key: 'gone.mp3' } });
    const update = prismaMock.musicRoom.update.mock.calls[0][0];
    expect(update.data.mediaUrl).toBeNull();
    expect(update.data.mediaExpiresAt).toBeNull();
  });
});

describe('deleteRoom', () => {
  it('refuses a non-host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(membership('GUEST'));
    const res = makeRes();
    await deleteRoom(makeReq({ params: { id: ROOM } }), res);
    expect(statusOf(res)).toBe(403);
    expect(prismaMock.musicRoom.delete).not.toHaveBeenCalled();
  });

  it('removes the room and its upload for the host', async () => {
    prismaMock.musicRoomMember.findUnique.mockResolvedValue(
      membership('HOST', { mediaUrl: '/uploads/bye.mp3' })
    );
    const res = makeRes();
    await deleteRoom(makeReq({ params: { id: ROOM } }), res);

    expect(statusOf(res)).toBe(200);
    expect(prismaMock.uploadedFile.delete).toHaveBeenCalledWith({ where: { key: 'bye.mp3' } });
    expect(prismaMock.musicRoom.delete).toHaveBeenCalledWith({ where: { id: ROOM } });
    expect(emitToMusicRoom).toHaveBeenCalledWith(ROOM, 'music_room_ended', { roomId: ROOM });
  });
});

/**
 * Live attendance for music rooms.
 *
 * `memberCount` is a membership total (it only grows until someone explicitly
 * leaves), so the "here now" number comes from the connected sockets instead.
 * These cases pin the two rules that number depends on: one person with two
 * tabs counts once, and a socket that is leaving is not counted.
 */
import { describe, expect, it } from 'vitest';
import { presenceUserIds, musicRoomPresenceSnapshot } from '../services/socketService';

const socket = (id: string, userId?: string) => ({ id, data: userId ? { userId } : {} });

describe('presenceUserIds', () => {
  it('counts distinct users, not sockets', () => {
    const ids = presenceUserIds([
      socket('a', 'user-1'),
      socket('b', 'user-1'), // second tab of the same person
      socket('c', 'user-2'),
    ]);
    expect(ids.sort()).toEqual(['user-1', 'user-2']);
  });

  it('skips the socket that is leaving or gone', () => {
    const ids = presenceUserIds([socket('a', 'user-1'), socket('b', 'user-2')], 'b');
    expect(ids).toEqual(['user-1']);
  });

  it('ignores sockets with no stamped user id', () => {
    expect(presenceUserIds([socket('a'), socket('b', 'user-1')])).toEqual(['user-1']);
  });

  it('returns nothing for an empty room', () => {
    expect(presenceUserIds([])).toEqual([]);
  });
});

describe('musicRoomPresenceSnapshot', () => {
  it('falls back to the caller id before the socket server is up', () => {
    // ioInstance is null in this process (no HTTP server is initialised by the
    // test suite), which is exactly the state a request that arrives during a
    // cold start would see.
    return musicRoomPresenceSnapshot('room-1', { includeUserId: 'user-1' }).then((ids) => {
      expect(ids).toEqual(['user-1']);
    });
  });

  it('reports an empty room when there is nothing to fall back to', async () => {
    await expect(musicRoomPresenceSnapshot('room-1')).resolves.toEqual([]);
  });
});

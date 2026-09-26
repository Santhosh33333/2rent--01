// Shared runtime state for running more than one API instance.
//
// Everything here is optional. With no REDIS_URL the process keeps its state in
// a local Map, which is exactly the single-instance behaviour we had before, so
// a missing or unreachable Redis degrades to "runs, but not shared" instead of
// taking the API down. Set REDIS_URL to scale out safely.
import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<boolean> | null = null;
// A connection in subscriber mode cannot issue normal commands, so the Socket.IO
// adapter needs its own pair of connections.
let pubClient: RedisClientType | null = null;
let subClient: RedisClientType | null = null;

/** Adapter connections, or null when Redis is not in play. */
export function redisAdapterClients(): { pub: RedisClientType; sub: RedisClientType } | null {
  return pubClient?.isReady && subClient?.isReady ? { pub: pubClient, sub: subClient } : null;
}

/** True when this process can talk to Redis, i.e. shared state is in play. */
export function redisEnabled(): boolean {
  return client?.isReady === true;
}

/**
 * Connect once at boot. Never throws: a failed connection logs and leaves the
 * caller on the in-memory path, because losing the cache is far better than
 * refusing to serve traffic.
 */
export async function initRedis(url = process.env.REDIS_URL): Promise<boolean> {
  if (!url) return false;
  if (client?.isReady) return true;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const c: RedisClientType = createClient({
        url,
        // Fail fast instead of queueing commands forever behind a dead socket.
        socket: { connectTimeout: 5_000, reconnectStrategy: (r) => Math.min(r * 200, 5_000) },
      });
      // Without a listener node-redis throws on background reconnects, which
      // would crash the process during a Redis blip.
      c.on("error", (err) => console.error("[REDIS]", err?.message));
      await c.connect();
      client = c;

      // Duplicates for the adapter; a failure here only costs us cross-instance
      // fan-out, so the main client stays usable either way.
      try {
        pubClient = c.duplicate();
        subClient = c.duplicate();
        pubClient.on("error", (err) => console.error("[REDIS pub]", err?.message));
        subClient.on("error", (err) => console.error("[REDIS sub]", err?.message));
        await Promise.all([pubClient.connect(), subClient.connect()]);
      } catch (err) {
        console.error("[REDIS] adapter clients unavailable:", (err as Error)?.message);
        pubClient = null;
        subClient = null;
      }

      console.log("[REDIS] connected - shared state enabled");
      return true;
    } catch (err) {
      console.error("[REDIS] unavailable, using in-process state:", (err as Error)?.message);
      client = null;
      return false;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function closeRedis(): Promise<void> {
  try {
    await subClient?.quit();
    await pubClient?.quit();
    if (client?.isOpen) await client.quit();
  } catch {
    /* shutting down anyway */
  } finally {
    subClient = null;
    pubClient = null;
    client = null;
  }
}

function redis(): RedisClientType | null {
  return client?.isReady ? client : null;
}

// ---------------------------------------------------------------------------
// String helpers: read-through cache with a per-key TTL.
//
// Used for pricing rules and similar hot reads that must not differ between
// instances. On a Redis miss the caller computes the value and writes it back
// through cacheSet().
// ---------------------------------------------------------------------------

export async function cacheGet<T>(key: string): Promise<T | null> {
  const c = redis();
  if (!c) return null;
  try {
    const raw = await c.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlMs: number): Promise<void> {
  const c = redis();
  if (!c) return;
  try {
    await c.set(key, JSON.stringify(value), { PX: ttlMs });
  } catch {
    /* a cache write is never worth failing a request over */
  }
}

export async function cacheDel(...keys: string[]): Promise<void> {
  const c = redis();
  if (!c || keys.length === 0) return;
  try {
    await c.del(keys);
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Live call state.
//
// Ringing and in-progress calls must be visible to every instance, otherwise
// the instance holding the callee's socket cannot resolve a callId that was
// created elsewhere and answers CALL_GONE. Keys carry a TTL so a crashed
// instance cannot strand a call: the entry simply expires.
// ---------------------------------------------------------------------------

const LIVE_TTL_MS = 6 * 60 * 60 * 1000; // 6h; a call cannot legitimately last longer
const liveKey = (callId: string) => `nb:call:${callId}`;
const userCallsKey = (userId: string) => `nb:calluser:${userId}`;

export interface SharedCall {
  id: string;
  callerId: string;
  receiverId: string;
  type: string;
  startedAt: number;
}

/** In-process fallback used when Redis is not configured. */
const localCalls = new Map<string, SharedCall>();

export async function putLiveCall(call: SharedCall): Promise<void> {
  localCalls.set(call.id, call);
  const c = redis();
  if (!c) return;
  try {
    await c.set(liveKey(call.id), JSON.stringify(call), { PX: LIVE_TTL_MS });
    // Reverse index so a disconnect can find a user's calls on any instance.
    await Promise.all([
      c.sAdd(userCallsKey(call.callerId), call.id),
      c.sAdd(userCallsKey(call.receiverId), call.id),
      c.pExpire(userCallsKey(call.callerId), LIVE_TTL_MS),
      c.pExpire(userCallsKey(call.receiverId), LIVE_TTL_MS),
    ]);
  } catch {
    /* fall back to the local copy we already stored */
  }
}

export async function getLiveCall(callId: string): Promise<SharedCall | null> {
  const c = redis();
  if (c) {
    try {
      const raw = await c.get(liveKey(callId));
      if (raw) return JSON.parse(raw) as SharedCall;
    } catch {
      /* fall through to local */
    }
  }
  return localCalls.get(callId) ?? null;
}

export async function updateLiveCall(callId: string, patch: Partial<SharedCall>): Promise<void> {
  const current = await getLiveCall(callId);
  if (!current) return;
  await putLiveCall({ ...current, ...patch });
}

export async function dropLiveCall(call: SharedCall): Promise<void> {
  localCalls.delete(call.id);
  const c = redis();
  if (!c) return;
  try {
    await c.del(liveKey(call.id));
    await Promise.all([c.sRem(userCallsKey(call.callerId), call.id), c.sRem(userCallsKey(call.receiverId), call.id)]);
  } catch {
    /* ignore */
  }
}

/** Every live call id involving this user, across all instances. */
export async function listLiveCallIds(userId: string): Promise<string[]> {
  const c = redis();
  if (c) {
    try {
      const ids = await c.sMembers(userCallsKey(userId));
      if (ids.length > 0) {
        // Drop ids whose call key has already expired so the set cannot grow.
        const live = await Promise.all(
          ids.map(async (id) => ((await c.exists(liveKey(id))) ? id : null)),
        );
        const alive = live.filter((id): id is string => id !== null);
        const stale = ids.filter((id) => !alive.includes(id));
        if (stale.length) await c.sRem(userCallsKey(userId), stale);
        return alive;
      }
    } catch {
      /* fall through to local */
    }
  }
  return [...localCalls.values()].filter((c2) => c2.callerId === userId || c2.receiverId === userId).map((c2) => c2.id);
}

/**
 * Shared presence: is this user connected anywhere?
 *
 * Without Redis a multi-instance deployment would report a user as offline
 * while they are online on another instance, so calls would be refused. With
 * Redis the answer is global.
 */
const PRESENCE_TTL_MS = 70 * 1000;

export async function markUserOnline(userId: string, socketCount: number): Promise<void> {
  const c = redis();
  if (!c) return;
  try {
    await c.set(`nb:online:${userId}`, String(socketCount), { PX: PRESENCE_TTL_MS });
  } catch {
    /* ignore */
  }
}

export async function clearUserOnline(userId: string): Promise<void> {
  const c = redis();
  if (!c) return;
  try {
    await c.del(`nb:online:${userId}`);
  } catch {
    /* ignore */
  }
}

export async function isUserOnlineShared(userId: string): Promise<boolean | null> {
  const c = redis();
  if (!c) return null; // unknown: caller should fall back to local state
  try {
    return (await c.exists(`nb:online:${userId}`)) === 1;
  } catch {
    return null;
  }
}

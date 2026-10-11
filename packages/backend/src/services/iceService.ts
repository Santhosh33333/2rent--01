// ICE (STUN/TURN) configuration for in-app WebRTC calls.
//
// STUN alone can discover a peer's public address, but it cannot relay media
// through symmetric NAT or carrier-grade NAT — which is what virtually every
// mobile network uses. Without a TURN relay a call can ring, connect the
// handshake, and then carry no audio at all. This service is the single place
// that decides which relay clients should use, so a provider can be swapped in
// through environment variables without rebuilding and re-shipping the app.
//
// Resolution order (first match wins):
//   1. A static TURN server from env: TURN_URL / TURN_USERNAME / TURN_CREDENTIAL.
//      Works with any provider (Metered, Cloudflare, Twilio, self-hosted coturn).
//   2. Twilio Network Traversal Service: short-lived credentials minted from
//      TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN. Only used when those look real.
//   3. A public fallback relay, so a call still connects with no configuration.
//
// Credentials are served at runtime (never baked into the web bundle), so they
// are not scrapable from the shipped JavaScript.
import { env } from "../config/env";

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfig {
  iceServers: IceServerConfig[];
  /** How long (seconds) a client may cache this answer before re-fetching. */
  ttl: number;
  /** Which tier answered — useful for diagnostics, never a secret. */
  source: string;
}

// Google + Cloudflare STUN: two independent providers so one being unreachable
// (blocked DNS, regional outage) still leaves the reflexive candidates usable.
const STUN_SERVERS: IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  { urls: ["stun:stun.cloudflare.com:3478"] },
];

// Public Metered "Open Relay" project. It needs no account and keeps calls
// working out of the box, but it is shared and rate-limited, so a dedicated
// relay should be configured for production traffic.
const PUBLIC_FALLBACK_TURN: IceServerConfig = {
  urls: [
    "turn:openrelay.metered.ca:80",
    "turn:openrelay.metered.ca:443",
    "turn:openrelay.metered.ca:443?transport=tcp",
    "turns:openrelay.metered.ca:443?transport=tcp",
  ],
  username: "openrelayproject",
  credential: "openrelayproject",
};

const DEFAULT_TURN_TTL_SECONDS = 3600;
const STATIC_CACHE_SECONDS = 3600;

let cache: { config: IceConfig; expiresAt: number } | null = null;

function splitUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function turnTtlSeconds(): number {
  const parsed = Number(env.TURN_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_TURN_TTL_SECONDS;
  // Twilio's NTS accepts 60s..86400s; clamp to that window.
  return Math.min(86400, Math.max(60, Math.floor(parsed)));
}

/**
 * A real Twilio Account SID is "AC" followed by 32 hex characters. The .env
 * placeholder ("your_account_sid_here") does not match, so a half-configured
 * environment can never be mistaken for a working relay.
 */
function hasTwilioCreds(): boolean {
  const sid = (env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (env.TWILIO_AUTH_TOKEN || "").trim();
  if (!/^AC[0-9a-fA-F]{32}$/.test(sid)) return false;
  if (!token || /your_|placeholder|changeme/i.test(token)) return false;
  return true;
}

async function mintTwilioTurn(): Promise<IceServerConfig[]> {
  const sid = (env.TWILIO_ACCOUNT_SID || "").trim();
  const token = (env.TWILIO_AUTH_TOKEN || "").trim();
  const auth = Buffer.from(`${sid}:${token}`).toString("base64");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ Ttl: String(turnTtlSeconds()) }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Twilio NTS responded ${res.status}`);
    }
    const data: any = await res.json();
    const servers: IceServerConfig[] = (data?.ice_servers || [])
      .map((s: any) => ({ urls: s?.url, username: s?.username, credential: s?.credential }))
      .filter((s: IceServerConfig) => Boolean(s.urls && s.username && s.credential));
    if (servers.length === 0) throw new Error("Twilio NTS returned no usable ICE servers");
    return servers;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decide which relay to hand to clients. Returns the config plus how long it
 * may be cached (Twilio credentials expire, so that window is shorter).
 */
async function resolveIceConfig(): Promise<{ config: IceConfig; cacheSeconds: number }> {
  let turn: IceServerConfig[] = [];
  let source = "public-relay";
  let cacheSeconds = STATIC_CACHE_SECONDS;

  // 1) Operator-provided TURN (any provider) wins — most explicit, most trusted.
  const staticUrls = splitUrls(env.TURN_URL);
  if (staticUrls.length > 0) {
    turn = [
      {
        urls: staticUrls,
        username: env.TURN_USERNAME || undefined,
        credential: env.TURN_CREDENTIAL || undefined,
      },
    ];
    source = "env-turn";
  }

  // 2) Twilio NTS: mint short-lived credentials when the account looks real.
  if (turn.length === 0 && hasTwilioCreds()) {
    try {
      turn = await mintTwilioTurn();
      source = "twilio-nts";
      // Refresh 5 minutes before the credentials actually expire.
      cacheSeconds = Math.max(60, turnTtlSeconds() - 300);
    } catch (err) {
      console.warn(`[ice] Twilio NTS unavailable: ${(err as Error).message}`);
    }
  }

  // 3) Public fallback relay so a call still connects with no configuration.
  if (turn.length === 0) {
    turn = [PUBLIC_FALLBACK_TURN];
    source = "public-relay";
  }

  return {
    config: { iceServers: [...STUN_SERVERS, ...turn], ttl: cacheSeconds, source },
    cacheSeconds,
  };
}

export async function getIceConfig(): Promise<IceConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { ...cache.config, ttl: Math.floor((cache.expiresAt - now) / 1000) };
  }
  const { config, cacheSeconds } = await resolveIceConfig();
  cache = { config, expiresAt: now + cacheSeconds * 1000 };
  return config;
}

/** Exposed for tests — forget any cached ICE answer. */
export function resetIceCache(): void {
  cache = null;
}

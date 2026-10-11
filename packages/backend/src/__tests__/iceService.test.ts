import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// env is read at module load, so it is mocked to keep these tests hermetic (no
// real .env, no database, no network) and to let each case flip configuration.
const mockEnv = vi.hoisted(() => ({
  TURN_URL: undefined as string | undefined,
  TURN_USERNAME: undefined as string | undefined,
  TURN_CREDENTIAL: undefined as string | undefined,
  TURN_TTL_SECONDS: undefined as string | undefined,
  TWILIO_ACCOUNT_SID: undefined as string | undefined,
  TWILIO_AUTH_TOKEN: undefined as string | undefined,
}));

vi.mock('../config/env', () => ({ env: mockEnv }));

import { getIceConfig, resetIceCache } from '../services/iceService';

function resetEnv() {
  mockEnv.TURN_URL = undefined;
  mockEnv.TURN_USERNAME = undefined;
  mockEnv.TURN_CREDENTIAL = undefined;
  mockEnv.TURN_TTL_SECONDS = undefined;
  mockEnv.TWILIO_ACCOUNT_SID = undefined;
  mockEnv.TWILIO_AUTH_TOKEN = undefined;
}

function flattenUrls(config: { iceServers: Array<{ urls: string | string[] }> }): string {
  return JSON.stringify(config.iceServers.map((s) => s.urls));
}

beforeEach(() => {
  resetEnv();
  resetIceCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ICE server resolution', () => {
  it('always includes STUN and a relay so a call can connect with no configuration', async () => {
    const config = await getIceConfig();
    expect(config.source).toBe('public-relay');
    expect(flattenUrls(config)).toContain('stun:stun.l.google.com:19302');
    expect(flattenUrls(config)).toContain('turn:openrelay.metered.ca:443');
    expect(config.ttl).toBeGreaterThan(0);
  });

  it('prefers an operator-configured TURN relay over the public fallback', async () => {
    mockEnv.TURN_URL = 'turn:relay.example.com:3478,turns:relay.example.com:443';
    mockEnv.TURN_USERNAME = 'nabri';
    mockEnv.TURN_CREDENTIAL = 'secret';
    const config = await getIceConfig();
    expect(config.source).toBe('env-turn');
    const relay = config.iceServers.find((s) => String(s.urls).includes('relay.example.com'));
    expect(relay).toMatchObject({ username: 'nabri', credential: 'secret' });
    expect(flattenUrls(config)).not.toContain('openrelay.metered.ca');
  });

  it('mints short-lived Twilio credentials when a real account is configured', async () => {
    mockEnv.TWILIO_ACCOUNT_SID = 'AC' + 'a'.repeat(32);
    mockEnv.TWILIO_AUTH_TOKEN = 'realtokenvalue';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ice_servers: [
          {
            url: 'turn:global.turn.twilio.com:3478?transport=udp',
            username: 'ephemeral-user',
            credential: 'ephemeral-pass',
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const config = await getIceConfig();
    expect(config.source).toBe('twilio-nts');
    const relay = config.iceServers.find((s) => String(s.urls).includes('global.turn.twilio.com'));
    expect(relay).toMatchObject({ username: 'ephemeral-user', credential: 'ephemeral-pass' });
    expect(flattenUrls(config)).not.toContain('openrelay.metered.ca');
  });

  it('does not call Twilio NTS with a placeholder account sid', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    mockEnv.TWILIO_ACCOUNT_SID = 'your_account_sid_here';
    mockEnv.TWILIO_AUTH_TOKEN = 'your_auth_token_here';
    const config = await getIceConfig();
    expect(config.source).toBe('public-relay');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to the public relay when Twilio NTS fails', async () => {
    mockEnv.TWILIO_ACCOUNT_SID = 'AC' + 'b'.repeat(32);
    mockEnv.TWILIO_AUTH_TOKEN = 'realtoken';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    const config = await getIceConfig();
    expect(config.source).toBe('public-relay');
    expect(flattenUrls(config)).toContain('openrelay.metered.ca');
  });

  it('caches the answer so repeated requests do not refetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ice_servers: [{ url: 'turn:global.turn.twilio.com:3478', username: 'u', credential: 'c' }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    mockEnv.TWILIO_ACCOUNT_SID = `AC${'0'.repeat(32)}`;
    mockEnv.TWILIO_AUTH_TOKEN = 'realtoken';

    await getIceConfig();
    await getIceConfig();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

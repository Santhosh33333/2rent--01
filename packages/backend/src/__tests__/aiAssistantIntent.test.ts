import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * detectIntent picks which branch of askAssistant answers. It matched only
 * singular words with explicit boundaries, and \bevent\b never matches
 * "events" — no word boundary before the trailing s — so the phrasing people
 * actually use ("any events this week", "movies", "communities near me",
 * "my bookings") fell through to the generic help reply while the live-data
 * branches sat unused. `communit` was dead too: no English word ends there.
 *
 * Each case below is a phrase that routed to help before the fix, asserted on
 * data.intent — the value that selects the branch — plus a negative control
 * that must stay on help. Plain 200s also prove the PII guard (added for this
 * endpoint) does not trip on ordinary questions.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  event: { findMany: vi.fn() },
  partner: { findMany: vi.fn() },
  community: { findMany: vi.fn() },
  booking: { findMany: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));
// aiController reaches config/env through utils/demo; nothing under test here
// needs real env, so the suite sets its own (as the other AI suites do).
vi.mock('../config/env', () => ({
  env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret', ADMIN_EMAIL: '' },
}));
vi.mock('../services/aiGateway', () => ({
  aiComplete: vi.fn(),
  aiChat: vi.fn(),
  aiProvider: vi.fn(),
  aiConfigInfo: vi.fn(),
  checkAiQuota: vi.fn(),
}));

import { askAssistant } from '../controllers/aiController';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}
function body(res: any) {
  return res.json.mock.calls[res.json.mock.calls.length - 1][0];
}

/** Ask a question the way the web app does and return the detected intent. */
async function intentOf(message: string): Promise<string> {
  const res = makeRes();
  await askAssistant(
    { body: { message }, params: {}, query: {}, headers: {}, user: { userId: 'user-1' } } as any,
    res,
  );
  expect(res.status).toHaveBeenCalledWith(200);
  return body(res).data.intent;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Every branch resolves to an honest empty; the assertion is on routing.
  prismaMock.user.findUnique.mockResolvedValue({ city: null });
  prismaMock.event.findMany.mockResolvedValue([]);
  prismaMock.partner.findMany.mockResolvedValue([]);
  prismaMock.community.findMany.mockResolvedValue([]);
  prismaMock.booking.findMany.mockResolvedValue([]);
});

describe('askAssistant intent routing — plurals', () => {
  it('routes "any events this week" to the events search (was: help)', async () => {
    expect(await intentOf('any events this week')).toBe('events');
    expect(prismaMock.event.findMany).toHaveBeenCalledTimes(1);
  });

  it('routes "any sports today" to the sports search (was: help)', async () => {
    expect(await intentOf('any sports today')).toBe('sports');
    expect(prismaMock.event.findMany).toHaveBeenCalledTimes(1);
  });

  it('routes "any movies this weekend" to the movies search (was: help)', async () => {
    expect(await intentOf('any movies this weekend')).toBe('movies');
    expect(prismaMock.event.findMany).toHaveBeenCalledTimes(1);
  });

  it('routes "partners available near me" to the partner search (was: help)', async () => {
    expect(await intentOf('partners available near me')).toBe('partners');
    expect(prismaMock.partner.findMany).toHaveBeenCalledTimes(1);
  });

  it('routes "communities near me" to the community search (was: help)', async () => {
    expect(await intentOf('communities near me')).toBe('communities');
    expect(prismaMock.community.findMany).toHaveBeenCalledTimes(1);
  });

  it('routes "my bookings" to the bookings lookup (was: help)', async () => {
    expect(await intentOf('my bookings')).toBe('bookings');
    expect(prismaMock.booking.findMany).toHaveBeenCalledTimes(1);
  });

  it('keeps plain chit-chat on the help reply', async () => {
    expect(await intentOf('hello there')).toBe('help');
  });
});

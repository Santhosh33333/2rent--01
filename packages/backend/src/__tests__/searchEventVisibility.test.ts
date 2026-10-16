import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Search must not be a back door onto events the app itself hides.
 *
 * Discovery already restricts to PUBLISHED/LIVE (buildEventWhere in
 * eventController), but the three search queries — results, the home page's
 * trending row and the autocomplete suggestions — were unguarded, so a
 * cancelled event kept appearing everywhere search touches. These pin the
 * generated Prisma `where` shape, the same way eventDiscovery.test.ts does for
 * the discovery filters.
 */

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), count: vi.fn() },
  event: { findMany: vi.fn(), count: vi.fn() },
  community: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('../config/database', () => ({ prisma: prismaMock }));

import { search, getTrendingSearches, getSuggestions } from '../controllers/searchController';

const VISIBLE = ['PUBLISHED', 'LIVE'];

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.user.count.mockResolvedValue(0);
  prismaMock.event.findMany.mockResolvedValue([]);
  prismaMock.event.count.mockResolvedValue(0);
  prismaMock.community.findMany.mockResolvedValue([]);
  prismaMock.community.count.mockResolvedValue(0);
});

/** The `where` of the Nth call to a mocked model method. */
function whereOf(mock: any, call = 0) {
  return mock.mock.calls[call]?.[0]?.where;
}

describe('search — events are limited to visible statuses', () => {
  it('guards both the results query and its count', async () => {
    const res = makeRes();
    await search({ query: { q: 'music', filter: 'events' } } as any, res as any);

    expect(whereOf(prismaMock.event.findMany)?.status).toEqual({ in: VISIBLE });
    expect(whereOf(prismaMock.event.count)?.status).toEqual({ in: VISIBLE });
  });
});

describe('search trending — the home row only shows visible upcoming events', () => {
  it('adds the status guard next to the upcoming filter', async () => {
    const res = makeRes();
    await getTrendingSearches({} as any, res as any);

    const where = whereOf(prismaMock.event.findMany);
    expect(where.status).toEqual({ in: VISIBLE });
    // The upcoming window must survive the change.
    expect(JSON.stringify(where)).toContain('startTime');
  });
});

describe('search suggestions — cancelled titles are not suggested', () => {
  it('guards the title autocomplete query', async () => {
    const res = makeRes();
    await getSuggestions({ query: { q: 'mu' } } as any, res as any);

    expect(whereOf(prismaMock.event.findMany)?.status).toEqual({ in: VISIBLE });
  });
});

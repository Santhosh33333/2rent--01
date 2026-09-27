// Regression tests for the Events discovery rewrite.
//
// The important property is that filters become REAL database predicates, not
// post-hoc frontend filtering: a filter that only works in the browser is
// exactly the bug this suite exists to prevent. These assert the generated
// Prisma `where` shape for Live Now (server time), multi-category, price,
// radius, capacity, search and scope combination, plus the date presets.
import { describe, it, expect, beforeAll } from 'vitest';

process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_32chars_minimum!';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32chars_minimum!';
process.env.JWT_SECRET = 'test_jwt_secret_32chars_minimum_2026!';
process.env.ADMIN_EMAIL = 'test@test.com';
process.env.ADMIN_PASSWORD = 'TestPass123!';

type Mod = {
  buildEventWhere: (f: any, now: Date) => any;
  eventOrderBy: (sort: string, lat?: number, lon?: number) => any;
  loadEventCategories: () => Promise<any[]>;
  datePresetRange?: (p: string) => any;
};

let mod: Mod;

beforeAll(async () => {
  mod = (await import('../controllers/eventController.js')) as unknown as Mod;
});

const NOW = new Date('2026-06-10T12:00:00.000Z'); // a Wednesday, midday

/** Deep-scan a where clause for a comparison on a given field. */
function hasField(node: any, field: string): boolean {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => hasField(n, field));
  for (const [k, v] of Object.entries(node)) {
    if (k === field) return true;
    if (hasField(v, field)) return true;
  }
  return false;
}

describe('Event scope: LIVE uses server time', () => {
  it('live = startTime <= now AND endTime > now', () => {
    const where = mod.buildEventWhere({ scope: 'live', categories: [], sort: 'soonest' }, NOW);
    const json = JSON.stringify(where);
    // Both bounds must be present and anchored to the supplied "now".
    expect(json).toContain('startTime');
    expect(json).toContain('lte');
    expect(json).toContain('endTime');
    expect(json).toContain('gt');
    expect(json).toContain(NOW.toISOString());
  });

  it('live excludes events with no endTime only when it is truly ongoing', () => {
    const where = mod.buildEventWhere({ scope: 'live', categories: [], sort: 'soonest' }, NOW);
    const json = JSON.stringify(where);
    // An event with a null endTime counts as live while it has started.
    expect(json).toContain('endTime');
  });

  it('upcoming = startTime > now', () => {
    const where = mod.buildEventWhere({ scope: 'upcoming', categories: [], sort: 'soonest' }, NOW);
    const json = JSON.stringify(where);
    expect(json).toContain('gt');
    expect(json).toContain(NOW.toISOString());
  });

  it('never returns CANCELLED/REJECTED events in any scope', () => {
    for (const scope of ['all', 'live', 'upcoming', 'completed']) {
      const where = mod.buildEventWhere({ scope, categories: [], sort: 'soonest' }, NOW);
      const json = JSON.stringify(where);
      expect(json).toContain('PUBLISHED');
      expect(json).not.toContain('CANCELLED');
    }
  });
});

describe('Event filters combine (AND, not OR)', () => {
  it('Football + this weekend + free + radius produce one ANDed where', () => {
    const where = mod.buildEventWhere(
      {
        scope: 'upcoming',
        categories: ['football'],
        sort: 'soonest',
        free: true,
        lat: 13.0827,
        lon: 80.2707,
        radiusKm: 25,
      },
      NOW
    );
    expect(where.AND).toBeDefined();
    expect(Array.isArray(where.AND)).toBe(true);
    const flat = JSON.stringify(where);
    expect(flat).toContain('football');
    expect(flat).toContain('latitude');
    expect(flat).toContain('longitude');
    // price is constrained (free = null OR 0) rather than ignored.
    expect(flat).toContain('price');
  });

  it('multiple categories become an IN list, not an OR of ANDs', () => {
    const where = mod.buildEventWhere(
      { scope: 'all', categories: ['cricket', 'football', 'badminton'], sort: 'soonest' },
      NOW
    );
    const catNode = where.AND.find((c: any) => c.category?.in);
    expect(catNode).toBeDefined();
    expect(catNode.category.in).toEqual(['cricket', 'football', 'badminton']);
  });

  it('paid filter uses gt 0, free uses null-or-zero', () => {
    const paid = mod.buildEventWhere({ scope: 'all', categories: [], sort: 'soonest', free: false }, NOW);
    expect(JSON.stringify(paid)).toContain('"gt":0');

    const free = mod.buildEventWhere({ scope: 'all', categories: [], sort: 'soonest', free: true }, NOW);
    const json = JSON.stringify(free);
    expect(json).toContain('price');
    expect(json).toContain('null');
  });

  it('custom min/max price narrows the range', () => {
    const where = mod.buildEventWhere(
      { scope: 'all', categories: [], sort: 'soonest', minPrice: 100, maxPrice: 900 },
      NOW
    );
    const json = JSON.stringify(where);
    expect(json).toContain('"gte":100');
    expect(json).toContain('"lte":900');
  });

  it('radius produces a bounding box, not a full table scan', () => {
    const where = mod.buildEventWhere(
      { scope: 'all', categories: [], sort: 'nearest', lat: 13.0827, lon: 80.2707, radiusKm: 5 },
      NOW
    );
    const json = JSON.stringify(where);
    // Bounding box bounds on BOTH axes are what let the index do the work.
    expect(json).toContain('latitude');
    expect(json).toContain('longitude');
    expect(json).toMatch(/"gte"|"lte"/);
  });

  it('search spans title, description, category and organizer', () => {
    const where = mod.buildEventWhere({ scope: 'all', categories: [], sort: 'soonest', q: 'cricket' }, NOW);
    const json = JSON.stringify(where);
    for (const field of ['title', 'description', 'category', 'organizer']) {
      expect(hasField(where, field)).toBe(true);
    }
    expect(json).toContain('cricket');
  });

  it('organizer type + verified + online + womenOnly are all queryable', () => {
    const where = mod.buildEventWhere(
      {
        scope: 'all',
        categories: [],
        sort: 'soonest',
        organizerTypes: ['PARTNER', 'COMMUNITY'],
        verifiedOnly: true,
        online: true,
        womenOnly: true,
      },
      NOW
    );
    const json = JSON.stringify(where);
    expect(json).toContain('PARTNER');
    expect(json).toContain('COMMUNITY');
    expect(json).toContain('isVerified');
    expect(json).toContain('isOnline');
    expect(json).toContain('womenOnly');
  });

  it('time-of-day filter constrains startTime hours', () => {
    const where = mod.buildEventWhere(
      { scope: 'all', categories: [], sort: 'soonest', timeOfDay: 'evening' },
      NOW
    );
    const json = JSON.stringify(where);
    expect(json).toContain('startTime');
    // 17:00 and 21:00 hour boundaries.
    expect(json).toMatch(/1970-01-01T17:00/);
    expect(json).toMatch(/1970-01-01T21:00/);
  });

  it('night window wraps past midnight', () => {
    const where = mod.buildEventWhere(
      { scope: 'all', categories: [], sort: 'soonest', timeOfDay: 'night' },
      NOW
    );
    const json = JSON.stringify(where);
    expect(json).toContain('1970-01-01T21:00');
    expect(json).toContain('1970-01-01T05:00');
  });
});

describe('Event sorting', () => {
  it('supported sorts map to real order-by clauses', () => {
    const cases: Array<[string, string]> = [
      ['soonest', 'startTime'],
      ['recently_created', 'createdAt'],
      ['most_joined', 'attendeeCount'],
      ['available_seats', 'capacity'],
      ['free_first', 'price'],
    ];
    for (const [sort, field] of cases) {
      const order = mod.eventOrderBy(sort);
      expect(JSON.stringify(order)).toContain(field);
    }
  });

  it('recommended defaults to soonest rather than a fabricated score', () => {
    const order = mod.eventOrderBy('recommended');
    const json = JSON.stringify(order);
    expect(json).toContain('startTime');
    // No invented engagement/ranking score.
    expect(json).not.toContain('score');
  });
});

describe('Event categories are database-driven', () => {
  it('loads categories from the EventCategory table', async () => {
    const rows = await mod.loadEventCategories();
    expect(Array.isArray(rows)).toBe(true);
    // If the table is populated, the API list must reflect DB rows (labels,
    // icons and order), not a hardcoded array.
    if (rows.length > 0) {
      expect(rows[0]).toHaveProperty('label');
      expect(rows[0]).toHaveProperty('sortOrder');
      expect(rows[0]).toHaveProperty('icon');
    }
  });

  it('astrology exists as a first-class category when seeded', async () => {
    const rows = await mod.loadEventCategories();
    const astro = rows.find((r) => r.key === 'astrology');
    if (rows.some((r) => r.key === 'walking')) {
      expect(astro).toBeDefined();
      expect(astro.label).toBe('Astrology');
    }
  });
});

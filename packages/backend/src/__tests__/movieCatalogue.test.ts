/**
 * The film catalogue's two load-bearing promises:
 *
 *   1. "Now playing" means now playing. This is what broke: the query had an
 *      upper date bound only and sorted by popularity, so it returned the most
 *      popular Indian film of all time and a 2021 release outranked a film that
 *      opened three days ago. The shelf looked frozen because it was, in the
 *      sense that nothing about it depended on today's date.
 *
 *   2. "Book tickets" goes somewhere real. The mapper used to hardcode
 *      `https://in.bookmyshow.com/search?q=<title>`, which 404s for every film -
 *      BookMyShow has no public search endpoint. Verified against the live site.
 *
 * Both are asserted against the actual upstream URL the service builds, not
 * against a re-implementation of it, so a future edit that drops the date range
 * fails here rather than in production.
 *
 * No network: `fetch` is stubbed and every request is captured. The env module
 * is mocked rather than mutated through process.env, because touching process.env
 * re-runs full environment validation on import - see publicOrigin.test.ts.
 */

// Mutable, because the service reads several of these once at module load.
const fakeEnv = vi.hoisted(() => ({
  value: {
    TMDB_API_KEY: 'test_tmdb_key_0000000000000000',
    TMDB_REGION: 'IN',
    TMDB_ORIGIN_COUNTRY: 'IN',
    TMDB_LANGUAGES: 'ta',
    TMDB_INCLUDE_ADULT: false,
    TMDB_COMING_SOON_DAYS: 7,
    TMDB_UPCOMING_HORIZON_DAYS: 120,
    TMDB_NOW_PLAYING_WINDOW_DAYS: 45,
    TMDB_BOOKING_BASE_URL: 'https://in.bookmyshow.com/movies',
    TMDB_CACHE_TTL_MINUTES: 30,
  } as Record<string, unknown>,
}));

vi.mock('../config/env', () => ({ env: fakeEnv.value }));

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Every URL the service requested, in order. */
let requested: string[] = [];

/** One TMDB result row. */
function row(id: number, title: string, releaseDate: string, popularity = 10) {
  return {
    id,
    title,
    name: title,
    release_date: releaseDate,
    original_language: 'ta',
    overview: `About ${title}.`,
    popularity,
    vote_average: 7.4,
    poster_path: `/p${id}.jpg`,
  };
}

/** The date params of a captured request, decoded. */
function paramsOf(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of url.split('?')[1].split('&')) {
    const [k, v] = pair.split('=');
    out[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
  }
  return out;
}

/**
 * Which of the three catalogue queries this URL is.
 *
 * All three carry a lower bound - that is the fix - so "has a .gte" no longer
 * tells them apart. The ranges are disjoint by construction, which is what makes
 * them identifiable: now playing ends today, coming soon starts tomorrow and ends
 * at the window, and the far shelf starts the day after that.
 */
type Query = 'nowPlaying' | 'comingSoon' | 'later';

function queryOf(url: string): Query {
  const gte = paramsOf(url)['primary_release_date.gte'];
  if (gte === istDay(1)) return 'comingSoon';
  if (gte === istDay(8)) return 'later';
  return 'nowPlaying';
}

/**
 * Answers each request with the matching fixture so the three catalogue calls can
 * return different rows. An unrecognised URL resolves to an empty result set
 * rather than throwing, so an unexpected extra call surfaces as an empty shelf
 * and a readable assertion instead of a confusing network error.
 */
function stubTmdb(released: any[], comingSoon: any[] = [], later: any[] = []) {
  const fixtures: Record<Query, any[]> = { nowPlaying: released, comingSoon, later };
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    requested.push(url);
    const results = fixtures[queryOf(url)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ page: 1, total_pages: 1, total_results: results.length, results }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Params of the request for one specific query. */
function paramsFor(query: Query): Record<string, string> {
  const url = requested.find((u) => queryOf(u) === query);
  expect(url, `a ${query} request was made`).toBeTruthy();
  return paramsOf(url!);
}

const nowPlayingParams = () => paramsFor('nowPlaying');
const comingSoonParams = () => paramsFor('comingSoon');
const laterParams = () => paramsFor('later');

/** Today in IST, which is the cinema day every date bound is built from. */
function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function istDay(offsetDays: number): string {
  const shifted = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

/** A pristine copy of the module-load-time config, for per-test overrides. */
const BASE_ENV = { ...fakeEnv.value };

/**
 * Fresh import of the service with the given config.
 *
 * The window length and booking base are read into module-level constants on
 * import, so overriding them requires a fresh module - hence the reset.
 */
async function loadService(overrides: Record<string, unknown> = {}) {
  Object.assign(fakeEnv.value, BASE_ENV, overrides);
  vi.resetModules();
  return await import('../services/movieService.js');
}

describe('now playing is bounded to films that can still be in cinemas', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('asks for a date RANGE, not everything up to today', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    const params = nowPlayingParams();
    expect(params['primary_release_date.lte']).toBe(todayIst());
    // The fix. Without a `.gte` this is the "most popular ever" query.
    expect(params['primary_release_date.gte']).toBeTruthy();
  });

  it('reaches back exactly the configured window', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    expect(nowPlayingParams()['primary_release_date.gte']).toBe(istDay(-45));
  });

  it('honours a different window length', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService({ TMDB_NOW_PLAYING_WINDOW_DAYS: 21 });
    await fetchIndianMovies();

    expect(nowPlayingParams()['primary_release_date.gte']).toBe(istDay(-21));
  });

  it('still only asks for theatrical releases', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    // 2 = theatrical, 3 = limited theatrical. TV and direct-to-video releases
    // are not something anyone can go and watch at a cinema.
    expect(nowPlayingParams().with_release_type).toBe('2|3');
  });
});

describe('a film appears on exactly one shelf', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('does not put a film opening today in both lists', async () => {
    // Today is the boundary. If the coming-soon query started at `.gte = today`
    // this film was fetched twice and rendered twice on the page, once as
    // playing and once as upcoming. Upstream is filtered by date range, but a
    // release date gets corrected after we fetch, so the service must not rely
    // on the range alone - hence the same film is returned from both calls here.
    stubTmdb([row(1, 'Opens Today', todayIst())], [row(1, 'Opens Today', todayIst())]);

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    const ids = [...feed.nowPlaying, ...feed.comingSoon].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    // And it is counted as playing, which is the truthful shelf for it.
    expect(feed.nowPlaying.map((m) => m.title)).toEqual(['Opens Today']);
    expect(feed.comingSoon).toEqual([]);
  });

  it('starts the coming-soon range at tomorrow', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))], [row(2, 'Tomorrow', istDay(1))]);

    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    expect(comingSoonParams()['primary_release_date.gte']).toBe(istDay(1));
  });

  it('keeps a film opening tomorrow out of now playing', async () => {
    stubTmdb([row(1, 'Opens Today', todayIst())], [row(2, 'Tomorrow', istDay(1))]);

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.nowPlaying.map((m) => m.title)).toEqual(['Opens Today']);
    expect(feed.comingSoon.map((m) => m.title)).toEqual(['Tomorrow']);
  });
});

describe('the future shelves show titles worth showing, soonest first', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('ranks the coming-soon query by popularity, not by date', async () => {
    // Sorted by date UPSTREAM, page 1 is the earliest-released titles in the
    // whole horizon, and TMDB has almost no data for Indian releases that far
    // out. Measured against the live API, all 20 titles a date-sorted 7 day
    // query returned had 0 votes and a popularity score under 2 - a Bhutanese
    // tunnel film, a Nepali short, a South African documentary.
    stubTmdb([row(1, 'Current', istDay(-3))], [row(2, 'This Friday', istDay(3), 1)]);

    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    expect(comingSoonParams().sort_by).toBe('popularity.desc');
  });

  it('orders the result by release date anyway, so Friday comes first', async () => {
    // Popularity decides who is in the list; date decides the order they appear.
    // Without the second half, a heavily hyped film outranks something opening
    // this Friday, which is what made this shelf read as un-updated even when it
    // was factually correct.
    stubTmdb(
      [row(1, 'Current', istDay(-3))],
      [row(2, 'Later This Week', istDay(6), 900), row(3, 'This Friday', istDay(3), 1)]
    );

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.comingSoon.map((m) => m.title)).toEqual(['This Friday', 'Later This Week']);
  });

  it('asks only for the coming-soon window, not the whole horizon', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))], [row(2, 'This Friday', istDay(3))]);

    const { fetchIndianMovies } = await loadService();
    await fetchIndianMovies();

    expect(comingSoonParams()['primary_release_date.lte']).toBe(istDay(7));
  });

  it('keeps the far shelf in a separate, non-overlapping query', async () => {
    stubTmdb(
      [row(1, 'Current', istDay(-3))],
      [row(2, 'Soon', istDay(3))],
      [row(3, 'Later', istDay(40))]
    );

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(laterParams()['primary_release_date.gte']).toBe(istDay(8));
    expect(laterParams()['primary_release_date.lte']).toBe(istDay(120));
    expect(laterParams().sort_by).toBe('popularity.desc');
    expect(feed.upcoming.map((m) => m.title)).toEqual(['Later']);
  });

  it('drops a film with no release date rather than showing it undated', async () => {
    // A release date arrives late for a lot of announced films, so an undated
    // row is routine upstream. It is dropped at the fetch layer: this list exists
    // to answer "what opens when", and a title with no date cannot answer it or
    // be ordered against one that has.
    stubTmdb(
      [row(1, 'Current', istDay(-3))],
      [{ ...row(2, 'Undated', istDay(2)), release_date: '' }, row(3, 'Dated', istDay(5))]
    );

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.comingSoon.map((m) => m.title)).toEqual(['Dated']);
  });
});

describe('booking links point somewhere real', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('never builds the BookMyShow search URL, which 404s for every film', async () => {
    stubTmdb([row(1, 'Drishyam: The Conclusion', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    const url = feed.nowPlaying[0].bookingUrl;
    // BookMyShow's header search is a JavaScript modal with no addressable URL.
    expect(url).not.toContain('/search');
    expect(url).toContain('bookmyshow.com');
  });

  it('is the configured partner page, absolute and reachable', async () => {
    stubTmdb([row(1, 'Any Film', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.nowPlaying[0].bookingUrl).toBe('https://in.bookmyshow.com/movies');
  });

  it('gives every film a booking link, so no poster renders a dead anchor', async () => {
    stubTmdb([row(1, 'One', istDay(-3)), row(2, 'Two', istDay(-5))]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    for (const movie of feed.nowPlaying) {
      expect(movie.bookingUrl).toMatch(/^https:\/\//);
    }
  });
});

describe('the feed survives an unreachable provider', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('reports stale instead of caching an outage as a real answer', async () => {
    // `null` from every attempt means "this network could not reach TMDB". An
    // empty shelf cached in that state would be a permanent lie for the TTL.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      })
    );

    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.stale).toBe(true);
    expect(feed.nowPlaying).toEqual([]);
  });

  it('does not mark a successful fetch stale', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.stale).toBe(false);
    expect(feed.nowPlaying).toHaveLength(1);
  });
});

describe('the catalogue only lists languages this audience watches', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('filters by original language, because region does not', async () => {
    // Measured against the live API on the endpoints this app was serving:
    // Resident Evil, Digger, Spider-Man: Brand New Day, The Odyssey. `region=IN`
    // only changes release-date certification and poster language, so it cannot
    // stand in for a nationality or language filter.
    stubTmdb([row(1, 'Current', istDay(-3))], [row(2, 'Soon', istDay(2))], [row(3, 'Later', istDay(30))]);
    const { fetchIndianMovies } = await loadService({ TMDB_LANGUAGES: 'ta' });
    await fetchIndianMovies();

    for (const query of ['nowPlaying', 'comingSoon', 'later'] as Query[]) {
      expect(paramsFor(query).with_original_language, query).toBe('ta');
    }
  });

  it('joins a priority list with a PIPE, which is what TMDB accepts', async () => {
    // A comma is accepted by the parameter and silently matches nothing: measured
    // live, `ta,en` returned zero results and `ta|en` returned both. That failure
    // has no error to catch, it just looks like "no films are listed".
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService({ TMDB_LANGUAGES: 'ta, en ,te' });
    await fetchIndianMovies();

    expect(nowPlayingParams().with_original_language).toBe('ta|en|te');
  });

  it('drops the filter entirely when no language is configured', async () => {
    stubTmdb([row(1, 'Current', istDay(-3))]);
    const { fetchIndianMovies } = await loadService({ TMDB_LANGUAGES: '' });
    await fetchIndianMovies();

    expect(nowPlayingParams().with_original_language).toBeUndefined();
  });

  it('exposes the same pipe-joined value for the search layer', async () => {
    const { catalogueLanguageFilter } = await loadService({ TMDB_LANGUAGES: 'ta,en' });
    expect(catalogueLanguageFilter()).toBe('ta|en');
  });
});

/**
 * Answers `/search/movie` with a different relevance page per call.
 *
 * TMDB's title search is ranked globally, so a Tamil release can appear on page
 * 3 - which is the whole reason the filtered search walks more than one page.
 */
function stubSearchPages(pages: any[][]) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    requested.push(url);
    const page = Number(paramsOf(url).page) || 1;
    const results = pages[page - 1] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({
        page,
        total_pages: pages.length,
        total_results: 4200,
        results,
      }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** A search row, tagged with the language it claims. */
function searchRow(id: number, title: string, language: string) {
  return { id, title, name: title, original_language: language, release_date: '2026-10-15' };
}

describe('search is filtered by language here, because TMDB does not do it', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('drops rows in other languages from the results', async () => {
    // TMDB's /search/movie ignores with_original_language - measured live, the
    // response was identical with and without the parameter. So "leo" came back
    // with eight Hollywood titles above the Tamil one.
    stubSearchPages([[searchRow(1, 'Leo', 'ta'), searchRow(2, 'Leo', 'en'), searchRow(3, 'Leo', 'ml')]]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: 'ta' });
    const data = await tmdb.searchMovies('leo');

    expect(data.movies.map((m) => m.title)).toEqual(['Leo']);
    expect(data.movies.every((m) => m.language === 'ta')).toBe(true);
  });

  it('keeps looking past the first page, because relevance is global', async () => {
    // The Tamil release is on page 3 of a global relevance ranking. Reading one
    // page and filtering it would answer "no results" for a film in the index.
    stubSearchPages([
      [searchRow(1, 'Leo', 'en'), searchRow(2, 'Leo', 'hi')],
      [searchRow(3, 'Leo', 'de'), searchRow(4, 'Leo', 'fr')],
      [searchRow(5, 'Leo', 'ta')],
    ]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: 'ta' });
    const data = await tmdb.searchMovies('leo');

    expect(data.movies.map((m) => m.id)).toEqual([5]);
    // Three pages asked for, and it stopped as soon as the upstream set ran out
    // rather than walking all four.
    expect(requested).toHaveLength(3);
  });

  it('stops early once it has enough matches', async () => {
    const full = Array.from({ length: 25 }, (_, i) => searchRow(i + 1, `Leo ${i}`, 'ta'));
    const fetchMock = stubSearchPages([full, full, full, full]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: 'ta' });
    const data = await tmdb.searchMovies('leo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.movies).toHaveLength(20);
  });

  it('bounds the walk, so a query like "the" cannot pull the catalogue', async () => {
    const allEnglish = Array.from({ length: 20 }, (_, i) => searchRow(i + 1, `The ${i}`, 'en'));
    const fetchMock = stubSearchPages([allEnglish, allEnglish, allEnglish, allEnglish, allEnglish]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: 'ta' });
    const data = await tmdb.searchMovies('the');

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(data.movies).toEqual([]);
  });

  it('does not report TMDB global totals that describe the rows it removed', async () => {
    // The stub reports total_results: 4200. Forwarding it would put "1,543
    // results" above a list of two Tamil films, and total_pages would offer a
    // pager across a set this endpoint never serves.
    stubSearchPages([[searchRow(1, 'Leo', 'ta'), searchRow(2, 'Leo', 'en')]]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: 'ta' });
    const data = await tmdb.searchMovies('leo');

    expect(data.totalResults).toBe(1);
    expect(data.totalPages).toBe(1);
    expect(data.movies).toHaveLength(1);
  });

  it('sends the query straight through when no language is configured', async () => {
    const fetchMock = stubSearchPages([[searchRow(1, 'Leo', 'ta'), searchRow(2, 'Leo', 'en')]]);
    const { tmdb } = await loadShelfServices({ TMDB_LANGUAGES: '' });
    const data = await tmdb.searchMovies('leo');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(data.movies.map((m) => m.language)).toEqual(['ta', 'en']);
    expect(data.totalResults).toBe(2);
  });
});

describe('a rating of zero means nobody voted, not that the film is hated', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('is null for an unrated release', async () => {
    stubTmdb([{ ...row(1, 'Opened Yesterday', istDay(-1)), vote_average: 0 }]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    // TMDB sends vote_average: 0 for a film nobody has rated. The card renders
    // "0.0" next to a star, which reads as a widely hated film.
    expect(feed.nowPlaying[0].rating).toBeNull();
  });

  it('is the score otherwise, to one decimal', async () => {
    stubTmdb([{ ...row(1, 'Loved', istDay(-1)), vote_average: 8.26 }]);
    const { fetchIndianMovies } = await loadService();
    const feed = await fetchIndianMovies();

    expect(feed.nowPlaying[0].rating).toBe(8.3);
  });
});

/**
 * Answers a discover request by the day its range starts on.
 *
 * Keyed on the lower bound because that is the only value that tells the shelves
 * apart: the three catalogue ranges and the two extra Movies-page shelves all end
 * on different days, and all of them have to be distinguishable from each other.
 * The page count is deliberately a lie - see the totalPages assertion below.
 */
function stubCatalogue(fixtures: Record<string, any[]>) {
  const fetchMock = vi.fn(async (input: any) => {
    const url = String(input);
    requested.push(url);
    const results = fixtures[paramsOf(url)['primary_release_date.gte']] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ page: 1, total_pages: 9, total_results: 4200, results }),
    } as any;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Both TMDB layers, freshly imported so they share one mock of the env. */
async function loadShelfServices(overrides: Record<string, unknown> = {}) {
  Object.assign(fakeEnv.value, BASE_ENV, overrides);
  vi.resetModules();
  return {
    movies: await import('../services/movieService.js'),
    tmdb: await import('../services/tmdbService.js'),
  };
}

describe('the Movies page shelves are date-bounded, not global charts', () => {
  beforeEach(() => {
    requested = [];
    vi.restoreAllMocks();
  });

  it('never calls TMDB curated list endpoints', async () => {
    // `/movie/popular` and `/movie/now_playing` are global hand-curated charts
    // with no date bound and no nationality filter. They are what put a Hollywood
    // blockbuster and an already-released film on a Tamil cinema app.
    stubCatalogue({});
    const { movies } = await loadShelfServices();
    await movies.fetchCatalogueTab('now_playing');
    await movies.fetchCatalogueTab('popular');
    await movies.fetchCatalogueTab('upcoming');
    await movies.fetchCatalogueTab('top_rated');

    expect(requested.length).toBeGreaterThan(0);
    for (const url of requested) {
      expect(url).not.toMatch(/\/3\/movie\/(now_playing|popular|upcoming|top_rated)\b/);
    }
  });

  it('answers "now playing" from the same shelf the landing page shows', async () => {
    stubCatalogue({
      [istDay(-45)]: [row(1, 'Current', istDay(-3))],
      [istDay(1)]: [row(2, 'This Friday', istDay(3))],
      [istDay(8)]: [row(3, 'Later', istDay(40))],
    });
    const { movies } = await loadShelfServices();
    const list = await movies.fetchCatalogueTab('now_playing');

    expect(list.map((m) => m.title)).toEqual(['Current']);
  });

  it('answers "upcoming" with everything not yet released, soonest first', async () => {
    stubCatalogue({
      [istDay(-45)]: [row(1, 'Current', istDay(-3))],
      // Deliberately out of order, and the first row opens today even though it
      // came back from the future query - a date corrected since the last fetch.
      [istDay(1)]: [row(3, 'Out Of Order', istDay(6)), { ...row(2, 'Opened Today', istDay(0)) }],
      [istDay(8)]: [row(4, 'Much Later', istDay(60))],
    });
    const { movies } = await loadShelfServices();
    const list = await movies.fetchCatalogueTab('upcoming');

    // "Opened Today" is gone even though the future query returned it, and the
    // remaining two are in date order despite arriving out of order.
    expect(list.map((m) => m.title)).toEqual(['Out Of Order', 'Much Later']);
  });

  it('bounds "popular" to the last quarter, still ordered by popularity', async () => {
    stubCatalogue({ [istDay(-90)]: [row(1, 'Hit', istDay(-5))] });
    const { movies } = await loadShelfServices();
    await movies.fetchCatalogueTab('popular');

    const url = requested.find((u) => paramsOf(u)['primary_release_date.gte'] === istDay(-90))!;
    const p = paramsOf(url);
    expect(p['primary_release_date.gte']).toBe(istDay(-90));
    expect(p['primary_release_date.lte']).toBe(todayIst());
    expect(p.sort_by).toBe('popularity.desc');
    expect(p.with_release_type).toBe('2|3');
  });

  it('requires votes for "top rated" and stops a month before today', async () => {
    // Two separate reasons. A film that opened on Monday has two ratings by
    // Tuesday and would otherwise top a chart of films people have seen; and an
    // average over a handful of votes is noise, not a rating.
    stubCatalogue({ [istDay(-365)]: [row(1, 'Acclaimed', istDay(-200))] });
    const { movies } = await loadShelfServices();
    await movies.fetchCatalogueTab('top_rated');

    const url = requested.find((u) => paramsOf(u)['primary_release_date.gte'] === istDay(-365))!;
    const p = paramsOf(url);
    expect(p['primary_release_date.lte']).toBe(istDay(-31));
    expect(p.sort_by).toBe('vote_average.desc');
    expect(p.vote_count).toBeUndefined();
    expect(p['vote_count.gte']).toBe('50');
  });

  it('drops a row TMDB returned that violates the range it was given', async () => {
    // The date bound is a query parameter, not a promise. A release date gets
    // corrected upstream after the query is answered.
    stubCatalogue({
      [istDay(-365)]: [
        row(1, 'Actually New', istDay(-2)),
        row(2, 'Genuinely Old', istDay(-200)),
      ],
    });
    const { movies } = await loadShelfServices();
    const list = await movies.fetchCatalogueTab('top_rated');

    expect(list.map((m) => m.title)).toEqual(['Genuinely Old']);
  });

  it('reports one page of results instead of forwarding TMDB global totals', async () => {
    // The stub answers with total_pages: 9 and total_results: 4200. Forwarding
    // those gave a pager over a chart of films this audience cannot see - a
    // control that could never lead anywhere real.
    stubCatalogue({ [istDay(-90)]: [row(1, 'Hit', istDay(-5))] });
    const { tmdb } = await loadShelfServices();
    const data = await tmdb.getMovieList('popular');

    expect(data.totalPages).toBe(1);
    expect(data.totalResults).toBe(data.movies.length);
    expect(data.movies.map((m) => m.title)).toEqual(['Hit']);
  });

  it('carries the real booking link and language through to the card', async () => {
    stubCatalogue({ [istDay(-90)]: [row(1, 'Hit', istDay(-5))] });
    const { tmdb } = await loadShelfServices();
    const data = await tmdb.getMovieList('popular');

    expect(data.movies[0].bookingUrl).toBe('https://in.bookmyshow.com/movies');
    expect(data.movies[0].language).toBe('ta');
    expect(data.movies[0].rating).toBe(7.4);
  });

  it('does not cache an unreachable provider as an empty shelf', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      })
    );
    const { movies } = await loadShelfServices({ TMDB_CACHE_TTL_MINUTES: 30 });
    const list = await movies.fetchCatalogueTab('popular');

    expect(list).toEqual([]);
    // A second call must go upstream again rather than inherit the outage for the
    // rest of the TTL.
    const before = (globalThis.fetch as any).mock.calls.length;
    await movies.fetchCatalogueTab('popular');
    expect((globalThis.fetch as any).mock.calls.length).toBeGreaterThan(before);
  });
});

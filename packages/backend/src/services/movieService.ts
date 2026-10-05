import { env } from "../config/env";

/**
 * Indian film catalogue: what is in cinemas now, and what is coming.
 *
 * WHAT THIS IS NOT
 * ----------------
 * There is no free, legitimate API that returns Chennai theatre showtimes and
 * prices. This was checked twice, not assumed:
 *
 *  - BookMyShow publishes no public API and has no developer signup. The only
 *    BookMyShow-hosted endpoint is an internal AdTech CMS. partner.bookmyshow.com
 *    is a commercial partner portal, not an API console. The "free BookMyShow
 *    API" projects on GitHub are personal screen-scrapers from 2016-2019, all
 *    unmaintained - which is the standing evidence that scraping their markup
 *    does not survive a redesign.
 *  - MovieGlu has a real showtime API, but it is UK-territory only.
 *
 * So TMDB answers WHICH Indian films are playing and WHEN they release, and the
 * organizer supplies theatre, showtime and price. Showtime data is left behind
 * `fetchShowtimes` rather than invented, because a fabricated showtime is worse
 * than an absent one: someone will turn up for a screening that does not exist.
 *
 * NO FALLBACK DATA. If TMDB is unreachable or unconfigured this returns empty
 * and the UI hides itself. There is deliberately no sample or placeholder film
 * list anywhere in this file - a demo film on a live page reads as real.
 *
 * TMDB is used under its attribution terms; the credit line is sent to the
 * client so the UI can render it.
 */

import { localDayKey } from "./localTime";
import { resolveIndianRegion } from "./indiaRegions";
import { msUntilIstMidnight } from "./istMidnight";

const TMDB_BASE = "https://api.themoviedb.org/3";

/** Cinemas are an Indian-local concept; all day boundaries follow IST. */
const MOVIE_TIMEZONE = "Asia/Kolkata";

/**
 * How far ahead "coming soon" reaches, in days.
 *
 * This is the number that makes a film releasing today have been visible before
 * today. Anything inside this window is on the shelf for the whole week leading
 * up to its release, so a title never appears for the first time on the day
 * people are looking for it.
 */
const COMING_SOON_DAYS = env.TMDB_COMING_SOON_DAYS;

/** How far ahead the wider "upcoming" shelf reaches. Beyond ~4 months the dates are guesswork. */
const UPCOMING_HORIZON_DAYS = env.TMDB_UPCOMING_HORIZON_DAYS;

/**
 * How far back "now playing" reaches, in days.
 *
 * A film stops being "now playing" when it leaves the cinemas, not when it stops
 * being popular. Without this bound the query is "the most popular Indian film
 * ever released", which is what made the shelf look frozen: a 2021 title outranked
 * everything that opened this month because it still has the larger TMDB
 * popularity score.
 */
const NOW_PLAYING_WINDOW_DAYS = env.TMDB_NOW_PLAYING_WINDOW_DAYS;

export interface MovieSummary {
  id: number;
  title: string;
  posterUrl: string | null;
  /** ISO release date, which for a released film is its theatrical opening. */
  releaseDate: string | null;
  originalLanguage: string | null;
  overview: string | null;
  /**
   * TMDB audience score out of 10, or null when there is not one.
   *
   * Null rather than 0: a film released last week has no votes, and TMDB sends
   * `vote_average: 0` for those. Rendering that as "0.0" tells a viewer the film
   * is hated, when the truth is nobody has rated it.
   */
  rating: number | null;
  /** Outbound search link. A link, not a scrape: nothing is fetched for them. */
  bookingUrl: string;
}

export interface MovieFeed {
  nowPlaying: MovieSummary[];
  /**
   * Releasing within COMING_SOON_DAYS, soonest first. This is the shelf that
   * guarantees a title is listed before its release day.
   */
  comingSoon: MovieSummary[];
  /** Everything further out than comingSoon, still within the long horizon. */
  upcoming: MovieSummary[];
  /** When this feed was fetched, so the client can say how fresh it is. */
  fetchedAt: string;
  /** True when upstream could not be reached and this is the last good feed. */
  stale: boolean;
}

export function moviesConfigured(): boolean {
  return Boolean(env.TMDB_API_KEY);
}

/**
 * "Today" for a cinema audience, as an IST calendar day.
 *
 * This used to be UTC, which quietly shifted the whole schedule: a film
 * released "today" only entered now-playing after 5:30 AM IST (the moment the
 * UTC date rolls over), and yesterday's releases stayed on for the morning
 * after they stopped playing. A cinema day starts at midnight local, so the
 * date filters have to be built from the local day, not the UTC one.
 */
function istDayKey(when: Date = new Date()): string {
  return localDayKey(when, MOVIE_TIMEZONE);
}

/** Calendar day in IST, `offsetDays` from today. */
function isoDay(offsetDays: number): string {
  if (offsetDays === 0) return istDayKey();
  const shifted = new Date(Date.now() + offsetDays * 864e5);
  return istDayKey(shifted);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function poster(path: string | null | undefined): string | null {  if (!path) return null;
  // TMDB serves images from a separate host; w500 is right for a card grid and
  // avoids pulling original-resolution files.
  return `https://image.tmdb.org/t/p/w500${path}`;
}

function mapMovie(raw: any): MovieSummary {
  const title = String(raw?.title || raw?.name || "").trim();
  return {
    id: Number(raw?.id) || 0,
    title,
    posterUrl: poster(raw?.poster_path),
    releaseDate: raw?.release_date || null,
    originalLanguage: raw?.original_language || null,
    overview: raw?.overview ? String(raw.overview).slice(0, 240) : null,
    rating: typeof raw?.vote_average === "number" && raw.vote_average > 0
      ? Math.round(raw.vote_average * 10) / 10
      : null,
    bookingUrl: bookingLink(),
  };
}

/**
 * Where "book tickets" goes.
 *
 * This used to be built per film as
 * `https://in.bookmyshow.com/search?q=<title>`. BookMyShow has no such
 * endpoint - its header search is a JavaScript modal with no addressable URL -
 * so the link 404'd for every film on the page, which is exactly what a visitor
 * tapping a poster hit. The replaced link is the real movies page, verified to
 * resolve, which is also the honest answer for an app with no ticketing
 * integration: we know WHICH films are playing, not WHICH seats are free.
 *
 * Kept as a function so the destination is read from config once and cannot
 * drift per film.
 */
function bookingLink(): string {
  return env.TMDB_BOOKING_BASE_URL;
}

function buildUrl(params: Record<string, string>): string {
  const qs = Object.entries({ api_key: env.TMDB_API_KEY || "", ...params })
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&");
  return `${TMDB_BASE}/discover/movie?${qs}`;
}

/**
 * TMDB connections from this network reset intermittently (observed: four
 * consecutive "Recv failure: Connection was reset" on the same URL that
 * succeeded moments later). Retries turn a visible outage into a brief latency
 * spike. The return contract distinguishes the two failure modes on purpose:
 * `[]` means the API itself answered "nothing here" (permanent, safe to cache);
 * `null` means this network could not reach TMDB at all (transient - caller
 * must NOT cache a null). A 4xx is treated as permanent: a bad key or bad
 * params will not fix themselves, and hammering a keyed endpoint with retries
 * is how accounts get throttled.
 */
async function fetchDiscover(
  params: Record<string, string>,
  attempts = 3
): Promise<MovieSummary[] | null> {
  const url = buildUrl(params);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        if (res.status >= 400 && res.status < 500) {
          console.error(`[MOVIES] TMDB rejected the request (${res.status}):`, body.slice(0, 300));
          return [];
        }
        console.error(`[MOVIES] TMDB returned ${res.status}`);
      } else {
        const data: any = await res.json();
        const results: any[] = Array.isArray(data?.results) ? data.results : [];
        // A film with no title or no date is unusable in a picker.
        return results.filter((m) => m?.title && m?.release_date).map(mapMovie);
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        console.error(`[MOVIES] TMDB request failed (attempt ${attempt}/${attempts}):`, err?.message || err);
      }
    } finally {
      clearTimeout(timer);
    }
    if (attempt < attempts) await new Promise((r) => setTimeout(r, 700));
  }
  return null;
}

/** Release dates change rarely and this is a landing-page read, so cache hard. */
const CACHE_TTL_MS = env.TMDB_CACHE_TTL_MINUTES * 60 * 1000;
let cache: { at: number; feed: MovieFeed; day: string } | null = null;
let inflight: Promise<MovieFeed> | null = null;

/**
 * Minutes from now until midnight IST.
 *
 * A 30 minute TTL alone does not roll the feed over at midnight: a cache
 * filled at 11:45 PM survives until 12:15 AM, so the landing page would show
 * "now playing" titles that stopped playing two hours earlier. The cache is
 * therefore also capped at the day boundary.
 *
 * There used to be a second, private copy of this calculation in this file that
 * nothing called - the day rollover was already handled by comparing the cached
 * day key below. The single source of truth is services/istMidnight.ts, which is
 * also what the scheduler arms itself with, so the cache expiry and the refresh
 * cannot drift apart.
 */

/** True when a cached feed is still the feed for the current cinema day. */
function cacheIsFresh(): boolean {
  if (!cache) return false;
  if (cache.day !== istDayKey()) return false; // midnight IST rolled over
  // Capped at the day boundary as well, so a feed fetched at 23:50 does not
  // outlive the cinema day it describes by a full 30 minute TTL.
  return Date.now() - cache.at < Math.min(CACHE_TTL_MS, msUntilIstMidnight());
}

/**
 * Shared base for every catalogue query.
 *
 * `with_origin_country` is the filter that actually matters for "which films can
 * this audience go and watch". It was pinned to `IN` on every request, which
 * meant the film list could not be widened without a code change, and the
 * separate tmdbService layer did the same thing a second time. Both now come
 * from config, and an empty origin country drops the filter entirely.
 *
 * `region` only affects release-date certification and poster language. It is
 * NOT a nationality filter and must not be used as one.
 */
function catalogueBase(): Record<string, string> {
  const base: Record<string, string> = {
    language: "en",
    include_adult: env.TMDB_INCLUDE_ADULT ? "true" : "false",
    include_video: "false",
  };
  if (env.TMDB_REGION) base.region = env.TMDB_REGION;
  if (env.TMDB_ORIGIN_COUNTRY) base.with_origin_country = env.TMDB_ORIGIN_COUNTRY;
  if (LANGUAGE_FILTER) base.with_original_language = LANGUAGE_FILTER;
  return base;
}

/**
 * The configured original languages, as TMDB wants them.
 *
 * `with_original_language` is an OR list and uses a PIPE separator. A comma is
 * not accepted: measured against the live API, `with_original_language=ta,en`
 * returned zero results and `ta|en` returned both. Getting this wrong produces an
 * empty catalogue that looks like "no films are listed" rather than an error, so
 * it is computed once, here, instead of at each call site.
 */
const LANGUAGE_FILTER = env.TMDB_LANGUAGES.split(",")
  .map((code) => code.trim())
  .filter(Boolean)
  .join("|");

/**
 * The same pipe-joined value, for the other TMDB surface.
 *
 * Search is a separate code path from the catalogue and would otherwise keep
 * ranking Tamil titles below Hollywood ones, so it reuses this rather than
 * re-deriving the separator (and getting it wrong again).
 */
export function catalogueLanguageFilter(): string {
  return LANGUAGE_FILTER;
}

/** Retained name so the two call sites below keep their meaning. */
function indiaBase(): Record<string, string> {
  return catalogueBase();
}

function daysUntil(dateStr: string, fromIsoDay: string): number {
  const target = Date.parse(`${dateStr}T00:00:00Z`);
  const base = Date.parse(`${fromIsoDay}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(base)) return Number.POSITIVE_INFINITY;
  return Math.round((target - base) / 864e5);
}

/**
 * Soonest first.
 *
 * "Coming soon" is a question about time, so it is answered by date - but the
 * ordering is applied locally rather than asked of TMDB, because sorting the
 * query by date returns the earliest-released titles in the horizon, which for
 * Indian releases is almost entirely long-tail noise. Ranking by popularity and
 * re-sorting by date keeps both halves. See the coming-soon query below.
 *
 * A film with no date sorts last rather than throwing: an undated title is not
 * something to put in front of someone deciding what to see this weekend.
 */
function byReleaseDateAsc(a: MovieSummary, b: MovieSummary): number {
  return (a.releaseDate ?? "9999-12-31").localeCompare(b.releaseDate ?? "9999-12-31");
}

/**
 * True when a film has not opened yet, so it belongs on a future shelf.
 *
 * The queries already start at tomorrow, but a release date gets corrected after
 * we fetch. A film that quietly moves onto both shelves is the most visible way
 * for this list to look broken, so the boundary is enforced here as well.
 */
function isStillUpcoming(m: MovieSummary, todayIso: string): boolean {
  if (!m.releaseDate) return true; // undated: announced, so not playing
  return daysUntil(m.releaseDate, todayIso) >= 1;
}

const EMPTY_FEED = (): MovieFeed => ({
  nowPlaying: [],
  comingSoon: [],
  upcoming: [],
  fetchedAt: new Date().toISOString(),
  stale: false,
});

export async function fetchIndianMovies(limit = 12): Promise<MovieFeed> {
  if (!env.TMDB_API_KEY) return EMPTY_FEED();
  if (cacheIsFresh() && cache) return slice(cache.feed, limit);
  // Collapse concurrent landing renders onto one pair of upstream requests.
  if (inflight) return slice(await inflight, limit);

  inflight = (async () => {
    const today = isoDay(0);

    // The three requests are staggered ~600ms apart. The resets this network
    // produces hit per-connection, and simultaneous connections burst at once;
    // a stagger makes it far less likely that all three fail their retry window
    // together and take the whole shelf down.
    const stagger = <T,>(ms: number, run: () => Promise<T>) =>
      new Promise<void>((r) => setTimeout(r, ms)).then(run);

    const releasedPromise = fetchDiscover({
      ...indiaBase(),
      // 2 = theatrical, 3 = limited theatrical. Anything else (TV, direct to
      // video) is not something anyone can go and watch at a cinema.
      with_release_type: "2|3",
      // BOTH ends of the range matter. `.lte = today` alone asked TMDB for
      // every Indian theatrical film ever released, sorted by popularity - so
      // "now playing" was really "most popular of all time" and a film from 2021
      // sat above one that opened last week. The lower bound is what makes this
      // a cinema shelf rather than a popularity chart.
      "primary_release_date.gte": isoDay(-NOW_PLAYING_WINDOW_DAYS),
      "primary_release_date.lte": today,
      sort_by: "popularity.desc",
      page: "1",
    });

    // "Coming soon" asks for the most notable films opening inside the window,
    // then re-sorts them by date locally (see byReleaseDateAsc).
    //
    // It used to be sorted by date UPSTREAM, which is the obvious way to get
    // "soonest first" and produces garbage. Page 1 of a date-sorted future query
    // is the earliest-released titles in the whole horizon, and TMDB has almost
    // no data for Indian releases that far out: measured against the live API,
    // all 20 titles it returned for a 7 day window had 0 votes and a popularity
    // score below 2 - a Bhutanese tunnel film, a Nepali short and a South
    // African documentary, none of which anyone in Chennai can book.
    //
    // Ranking by popularity first and ordering by date afterwards keeps both
    // halves: only titles worth showing get in, and they still arrive soonest
    // first.
    const soonPromise = stagger(600, () =>
      fetchDiscover({
        ...indiaBase(),
        with_release_type: "2|3",
        // TMDB expresses a date range as
        // `primary_release_date.gte=X&primary_release_date.lte=Y`.
        //
        // Starts at TOMORROW, not today. A film opening today satisfies both
        // this range and the now-playing range above, so with `.gte = today` it
        // was fetched twice and appeared twice on the page - once as playing and
        // once as upcoming. The shelf is exclusive: it opens today, so it plays.
        "primary_release_date.gte": isoDay(1),
        "primary_release_date.lte": isoDay(COMING_SOON_DAYS),
        sort_by: "popularity.desc",
        page: "1",
      })
    );

    // The far shelf. Same reasoning, wider window, so the two ranges do not
    // overlap and a title is never fetched twice.
    const laterPromise = stagger(1200, () =>
      fetchDiscover({
        ...indiaBase(),
        with_release_type: "2|3",
        "primary_release_date.gte": isoDay(COMING_SOON_DAYS + 1),
        "primary_release_date.lte": isoDay(UPCOMING_HORIZON_DAYS),
        sort_by: "popularity.desc",
        page: "1",
      })
    );

    const [released, soonRaw, laterRaw] = await Promise.all([
      releasedPromise,
      soonPromise,
      laterPromise,
    ]);

    // Both future shelves are ordered by date locally. TMDB returns one sort
    // order per request and "soonest first" is not the ordering that produces a
    // usable list, so the ordering is applied here instead.
    const soon = (soonRaw ?? []).filter((m) => isStillUpcoming(m, today)).sort(byReleaseDateAsc);
    const later = (laterRaw ?? []).filter((m) => isStillUpcoming(m, today)).sort(byReleaseDateAsc);

    // A null means the network could not reach TMDB for that feed. An empty
    // upcoming list would be a permanent lie for the next 30 minutes if cached
    // in that state, so a failed fetch is served as-is but deliberately NOT
    // cached - the next visitor retries upstream instead of inheriting the
    // outage. Only a clean fetch of every shelf is worth pinning downstream.
    const fetchedOk = released !== null && soonRaw !== null && laterRaw !== null;
    const feed: MovieFeed = {
      nowPlaying: released ?? [],
      comingSoon: soon,
      upcoming: later,
      fetchedAt: new Date().toISOString(),
      stale: !fetchedOk,
    };
    if (fetchedOk) {
      cache = { at: Date.now(), feed, day: istDayKey() };
    }
    return feed;
  })();

  try {
    return slice(await inflight, limit);
  } finally {
    inflight = null;
  }
}

function slice(feed: MovieFeed, limit: number): MovieFeed {
  return {
    nowPlaying: feed.nowPlaying.slice(0, limit),
    comingSoon: feed.comingSoon.slice(0, limit),
    upcoming: feed.upcoming.slice(0, limit),
    fetchedAt: feed.fetchedAt,
    stale: feed.stale,
  };
}

// --- the Movies page shelves --------------------------------------------------

/**
 * The four shelves the Movies page shows, expressed as date ranges.
 *
 * WHY NOT TMDB'S OWN /movie/{list} ENDPOINTS
 * ------------------------------------------
 * Those four lists are global, hand-curated popularity charts with no date
 * bounds and no nationality filter. `region=IN` does not make them Indian - it
 * only changes which release-date certification and poster language TMDB picks.
 * Measured against the live API on the "Now Playing" and "Popular" shelves this
 * app was actually serving: Resident Evil, Digger, Heart of the Beast, The
 * Uprising, Spider-Man: Brand New Day, The Odyssey. All Hollywood, none of them
 * something someone in Chennai can buy a ticket to. And because "Upcoming" has
 * no lower date bound it kept listing films that had already opened - the
 * August 7 title that was still sitting in the upcoming shelf weeks later.
 *
 * So every tab is defined here as a range against the same IST calendar day the
 * landing page uses, and answered by one discover query. One set of rules for
 * one audience: if a film is wrong on the landing page it is wrong here too, and
 * there is now only one place that can be wrong.
 */
const SHELVES = {
  now_playing: { from: -NOW_PLAYING_WINDOW_DAYS, to: 0, sortBy: "popularity.desc" },
  /**
   * "Popular" keeps its meaning - ordered by popularity - but is bounded to
   * roughly the last quarter. Unbounded, it is the all-time chart again, which
   * is how a 2021 film ends up above one that opened last month.
   */
  popular: { from: -90, to: 0, sortBy: "popularity.desc" },
  /** Everything not yet released, soonest first. Handled from the cached feed. */
  upcoming: { from: 1, to: UPCOMING_HORIZON_DAYS, sortBy: "popularity.desc" },
  /**
   * "Top rated" needs votes before it means anything, and it has to exclude the
   * last few weeks: a film that opened on Monday has two ratings by Tuesday and
   * would otherwise top a chart of films people have actually seen. The upper
   * bound is therefore 31 days ago, not today.
   */
  top_rated: { from: -365, to: -31, sortBy: "vote_average.desc", minVotes: 50 },
} as const;

export type CatalogueTab = keyof typeof SHELVES;

/** Per-tab cache, keyed by tab and page, valid for the current cinema day. */
const shelfCache = new Map<string, { at: number; day: string; movies: MovieSummary[] }>();

function shelfIsFresh(entry: { at: number; day: string } | undefined): boolean {
  if (!entry) return false;
  if (entry.day !== istDayKey()) return false;
  return Date.now() - entry.at < Math.min(CACHE_TTL_MS, msUntilIstMidnight());
}

/** Drops every cached shelf. Called by the sync agent after a refresh. */
export function clearShelfCache(): void {
  shelfCache.clear();
}

/**
 * One shelf of the Movies page.
 *
 * `now_playing` and `upcoming` are answered from the shared cached feed rather
 * than with their own request: they are the same two date ranges the landing
 * page shows, so a separate query would cost a second round trip to TMDB on
 * every tab switch and could disagree with what the landing page rendered.
 */
export async function fetchCatalogueTab(tab: CatalogueTab): Promise<MovieSummary[]> {
  if (!env.TMDB_API_KEY) return [];

  if (tab === "now_playing") {
    return (await fetchIndianMovies(60)).nowPlaying;
  }

  if (tab === "upcoming") {
    const feed = await fetchIndianMovies(60);
    // Both future shelves, still date-ordered, and still with the day boundary
    // enforced - a film whose date was corrected to today since the last fetch
    // is playing now, so it must not linger here.
    const today = isoDay(0);
    return [...feed.comingSoon, ...feed.upcoming]
      .filter((m) => isStillUpcoming(m, today))
      .sort(byReleaseDateAsc);
  }

  const spec = SHELVES[tab];
  const key = `${tab}:1`;
  const hit = shelfCache.get(key);
  if (shelfIsFresh(hit)) return hit!.movies;

  const params: Record<string, string> = {
    ...catalogueBase(),
    with_release_type: "2|3",
    "primary_release_date.gte": isoDay(spec.from),
    "primary_release_date.lte": isoDay(spec.to),
    sort_by: spec.sortBy,
    page: "1",
  };
  if ("minVotes" in spec && spec.minVotes) params["vote_count.gte"] = String(spec.minVotes);

  const rows = await fetchDiscover(params);
  // null means this network never reached TMDB. An empty shelf is the honest
  // answer to show for now, but caching it would pin "no popular films" to the
  // page for the rest of the day, so it is deliberately not cached.
  if (rows === null) return [];
  // The upper bound is a query parameter, not a guarantee - TMDB will happily
  // return a title whose date it has not corrected yet.
  const movies = rows.filter((m) => {
    if (!m.releaseDate) return false;
    return daysUntil(m.releaseDate, isoDay(0)) <= spec.to;
  });
  shelfCache.set(key, { at: Date.now(), day: istDayKey(), movies });
  return movies;
}

/**
 * Warms the cache ahead of the release day.
 *
 * Called on an interval and at boot so a film is on the shelf with its real
 * data before it opens, rather than being discovered for the first time when
 * someone opens the app on release day. Bypasses the freshness check on
 * purpose: refreshing before the cache would is the entire point.
 */
export async function syncMovieFeed(): Promise<{ ok: boolean; comingSoon: number }> {
  if (!env.TMDB_API_KEY) return { ok: false, comingSoon: 0 };
  cache = null;
  inflight = null;
  // The Movies page tabs are cached per day too, and would otherwise keep
  // serving yesterday's "popular" and "top rated" until each was opened once.
  clearShelfCache();
  const feed = await fetchIndianMovies(60);
  return { ok: !feed.stale, comingSoon: feed.comingSoon.length };
}

// --- location-aware catalogue ------------------------------------------------

/**
 * Films for a specific audience.
 *
 * The national list answers "what is in cinemas", but someone in Tamil Nadu
 * wants Tamil and Telugu releases first, and someone in Kerala wants Malayalam.
 * The region is resolved from a coordinate, then its languages are queried
 * alongside the national list and merged, local titles first.
 *
 * Every regional result is still filtered to theatrical releases, because a
 * regional language filter otherwise pulls in the entire streaming catalogue for
 * that language, most of which nobody can go and watch at a cinema.
 */
export async function fetchMoviesForLocation(
  lat?: number | null,
  lng?: number | null,
  limit = 12
): Promise<MovieFeed & { region: ReturnType<typeof resolveIndianRegion>; regionalCount: number }> {
  const region = resolveIndianRegion(lat, lng);
  const national = await fetchIndianMovies(limit);

  // Out of range or unconfigured: the national list is the honest answer, and
  // saying "Tamil Nadu" to someone in Dubai would be worse than not answering.
  if (!env.TMDB_API_KEY || !region.inRange || region.languages.length === 0) {
    return { ...national, region, regionalCount: 0 };
  }

  const wanted = region.languages.filter((l) => l !== "en");
  if (wanted.length === 0) {
    return { ...national, region, regionalCount: 0 };
  }

  // A configured language list is the audience definition, and the national list
  // already honours it. Widening by state on top would merge two different rules:
  // a visitor in Kerala would get the Tamil national shelf plus Malayalam
  // regional results, which is not a list of anything anyone can attend. So the
  // regional widening only runs when no language filter is configured, where it
  // is the only thing narrowing the national list at all.
  if (LANGUAGE_FILTER) {
    return { ...national, region, regionalCount: 0 };
  }

  // Each regional language is its own TMDB query. They are staggered for the
  // same per-connection reason the other two are: this network resets bursts.
  const regionalResults: MovieSummary[][] = [];
  for (const language of wanted.slice(0, 2)) {
    await sleep(350);
    const list = await fetchDiscover({
      language: "en",
      ...(env.TMDB_REGION ? { region: env.TMDB_REGION } : {}),
      with_original_language: language,
      with_release_type: "2|3",
      include_adult: env.TMDB_INCLUDE_ADULT ? "true" : "false",
      include_video: "false",
      "primary_release_date.gte": isoDay(-7),
      "primary_release_date.lte": isoDay(UPCOMING_HORIZON_DAYS),
      // Popularity first, date applied locally below - the same reasoning as the
      // national coming-soon query. A regional language filter narrows the pool
      // but does not make the early-released titles any more relevant.
      sort_by: "popularity.desc",
      page: "1",
    });
    regionalResults.push(list ?? []);
  }

  // Dedupe by TMDB id: a Telugu film is in both the Telugu and the national
  // query, and showing it twice is the most visible way to look broken.
  const seen = new Set<number>();
  const merged: MovieSummary[] = [];
  for (const list of [...regionalResults.flat(), ...national.nowPlaying]) {
    if (!list || seen.has(list.id)) continue;
    seen.add(list.id);
    merged.push(list);
  }

  const regionalIds = new Set(regionalResults.flat().map((m) => m.id));
  const isReleasedNow = (m: MovieSummary) =>
    !m.releaseDate || m.releaseDate <= isoDay(0);

  const nowPlaying = merged.filter((m) => isReleasedNow(m));
  const COMING_SOON = env.TMDB_COMING_SOON_DAYS;
  const soon = merged
    .filter((m) => !isReleasedNow(m) && daysUntil(m.releaseDate!, isoDay(0)) <= COMING_SOON)
    .sort(byReleaseDateAsc);
  const later = merged
    .filter((m) => !isReleasedNow(m) && daysUntil(m.releaseDate!, isoDay(0)) > COMING_SOON)
    .sort(byReleaseDateAsc);

  return {
    nowPlaying,
    comingSoon: soon,
    upcoming: later,
    fetchedAt: national.fetchedAt,
    stale: national.stale,
    region,
    // So a caller can tell "regional list, nothing matched that language" from
    // "regional list, nothing is playing" without a second request.
    regionalCount: regionalIds.size,
  };
}

/**
 * Deliberately a stub. Wiring a real ticketing provider means implementing this
 * one function and nothing above it changes. Returning null (not []) is what
 * tells the UI to say "the organiser sets the showtime" instead of "no showtimes
 * today", which would be false.
 */
export async function fetchShowtimes(_movieTitle: string): Promise<null> {
  return null;
}

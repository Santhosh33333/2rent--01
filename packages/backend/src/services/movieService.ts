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

const TMDB_BASE = "https://api.themoviedb.org/3";

/** How far ahead "upcoming" reaches. Beyond ~4 months the dates are guesswork. */
const UPCOMING_HORIZON_DAYS = 120;

export interface MovieSummary {
  id: number;
  title: string;
  posterUrl: string | null;
  /** ISO release date, which for a released film is its theatrical opening. */
  releaseDate: string | null;
  originalLanguage: string | null;
  overview: string | null;
  /** Outbound search link. A link, not a scrape: nothing is fetched for them. */
  bookingUrl: string;
}

export interface MovieFeed {
  nowPlaying: MovieSummary[];
  upcoming: MovieSummary[];
}

export function moviesConfigured(): boolean {
  return Boolean(env.TMDB_API_KEY);
}

function isoDay(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 864e5).toISOString().slice(0, 10);
}

function poster(path: string | null | undefined): string | null {
  if (!path) return null;
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
    bookingUrl: `https://in.bookmyshow.com/search?q=${encodeURIComponent(title)}`,
  };
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
const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { at: number; feed: MovieFeed } | null = null;
let inflight: Promise<MovieFeed> | null = null;

/**
 * Shared base: Indian origin only.
 *
 * `with_origin_country=IN` is the filter that actually matters. An earlier
 * version used `language=en-IN` with no origin filter and returned 12 English
 * Hollywood/indie titles - which is not "Indian movies" by any reading. Origin
 * country is the right axis; language is only used for display.
 */
function indiaBase(): Record<string, string> {
  return {
    language: "en",
    region: "IN",
    with_origin_country: "IN",
    include_adult: "false",
    include_video: "false",
  };
}

export async function fetchIndianMovies(limit = 12): Promise<MovieFeed> {
  if (!env.TMDB_API_KEY) return { nowPlaying: [], upcoming: [] };
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return slice(cache.feed, limit);
  // Collapse concurrent landing renders onto one pair of upstream requests.
  if (inflight) return slice(await inflight, limit);

  inflight = (async () => {
    // Start the two requests ~500ms apart. The resets this network produces
    // hit per-connection, and two simultaneous connections burst at once; a
    // stagger halves the chance both fail their retry window together.
    const releasedPromise = fetchDiscover({
      ...indiaBase(),
      // 2 = theatrical, 3 = limited theatrical. Anything else (TV, direct to
      // video) is not something anyone can go and watch at a cinema.
      with_release_type: "2|3",
      "primary_release_date.lte": isoDay(0),
      sort_by: "popularity.desc",
      page: "1",
    });
    const soonPromise = new Promise((r) => setTimeout(r, 500)).then(() =>
      fetchDiscover({
        ...indiaBase(),
        // TMDB expresses a date range as
        // `primary_release_date.gte=X&primary_release_date.lte=Y`.
        "primary_release_date.gte": isoDay(0),
        "primary_release_date.lte": isoDay(UPCOMING_HORIZON_DAYS),
        sort_by: "popularity.desc",
        page: "1",
      })
    );

    const [released, soon] = await Promise.all([releasedPromise, soonPromise]);

    // A null means the network could not reach TMDB for that feed. An empty
    // upcoming list would be a permanent lie for the next 30 minutes if cached
    // in that state, so a failed fetch is served as-is but deliberately NOT
    // cached - the next visitor retries upstream instead of inheriting the
    // outage. Only a clean fetch of both lists is worth pinning downstream.
    const feed: MovieFeed = { nowPlaying: released ?? [], upcoming: soon ?? [] };
    if (released !== null && soon !== null) {
      cache = { at: Date.now(), feed };
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
  return { nowPlaying: feed.nowPlaying.slice(0, limit), upcoming: feed.upcoming.slice(0, limit) };
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

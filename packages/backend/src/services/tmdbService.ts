import { env } from "../config/env";
import {
  fetchCatalogueTab,
  catalogueLanguageFilter,
  type CatalogueTab,
  type MovieSummary,
} from "./movieService";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG = "https://image.tmdb.org/t/p";
const FETCH_TIMEOUT_MS = 10000;

export function isMoviesConfigured(): boolean {
  return Boolean(env.TMDB_API_KEY);
}

export function moviesConfigError(): { message: string; requiredEnv: string[] } {
  return {
    message: "Movie listings are not configured on this server.",
    requiredEnv: ["TMDB_API_KEY"],
  };
}

async function tmdbGet(path: string, params: Record<string, string | number> = {}): Promise<any> {
  if (!env.TMDB_API_KEY) throw new Error("TMDB_API_KEY is not configured.");
  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", env.TMDB_API_KEY);
  url.searchParams.set("language", "en-US");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`TMDB responded ${res.status}.`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function shapeMovie(m: any) {
  return {
    id: m.id,
    title: m.title,
    overview: m.overview || "",
    posterUrl: m.poster_path ? `${TMDB_IMG}/w500${m.poster_path}` : null,
    backdropUrl: m.backdrop_path ? `${TMDB_IMG}/w780${m.backdrop_path}` : null,
    releaseDate: m.release_date || null,
    rating: typeof m.vote_average === "number" ? Math.round(m.vote_average * 10) / 10 : null,
    genreIds: Array.isArray(m.genre_ids) ? m.genre_ids : [],
    language: m.original_language || null,
  };
}

/**
 * Catalogue rows as the client expects them.
 *
 * `overview` becomes an empty string rather than null because the card treats an
 * empty overview as "no description" and hides the paragraph; null would render
 * the word "null". `bookingUrl` is passed through so a card can offer the real
 * booking page.
 */
function shapeSummary(m: MovieSummary) {
  return {
    id: m.id,
    title: m.title,
    overview: m.overview || "",
    posterUrl: m.posterUrl,
    backdropUrl: null,
    releaseDate: m.releaseDate,
    rating: m.rating,
    genreIds: [],
    language: m.originalLanguage,
    bookingUrl: m.bookingUrl,
  };
}

const LISTS = ["now_playing", "popular", "upcoming", "top_rated"] as const;
export type MovieList = (typeof LISTS)[number];

export function isMovieList(v: unknown): v is MovieList {
  return typeof v === "string" && (LISTS as readonly string[]).includes(v);
}

/**
 * A shelf from the app's own date-bounded catalogue.
 *
 * `totalPages` is 1 because that is what this returns. The previous version
 * forwarded TMDB's `total_pages` for a global, unfiltered chart, which reported
 * thousands of results for films this audience cannot see - a pager that could
 * never lead anywhere real. The four tabs are one ranked shelf each now, so the
 * honest page count is one.
 */
export async function getMovieList(list: MovieList, page = 1) {
  const movies = await fetchCatalogueTab(list as CatalogueTab);
  return {
    page: 1,
    totalPages: 1,
    totalResults: movies.length,
    movies: movies.map(shapeSummary),
  };
}

/** Rows one search returns. The client renders the whole list and does not page. */
const SEARCH_LIMIT = 20;

/**
 * How many upstream pages a filtered search walks.
 *
 * TMDB's `/search/movie` does not honour `with_original_language`. Measured live
 * on three queries, the response was identical with and without it - same
 * `total_results`, same mix of languages - so the filter has to be applied here
 * against the rows that actually arrive, not requested.
 *
 * Ranking is global relevance, so a Tamil title can land on page 3. Reading only
 * page 1 and filtering it would answer "no results" for a film that is in the
 * index, which is the worst thing a search box can do. So this walks a bounded
 * number of pages and keeps the matches - bounded, not exhaustive, so a query
 * like "the" cannot pull the whole catalogue.
 */
const SEARCH_MAX_PAGES = 4;

/**
 * Search, restricted to the languages the catalogue is built in.
 *
 * Without this, typing "leo" on a Tamil cinema app returns a Tamil film buried
 * under eight Hollywood titles with the same name. An empty
 * `TMDB_LANGUAGES` drops the restriction and sends the query straight through.
 */
export async function searchMovies(query: string) {
  const languages = catalogueLanguageFilter();
  const keep = languages ? new Set(languages.split("|")) : null;

  const params = {
    query,
    page: "1",
    include_adult: "false",
    region: env.TMDB_REGION || "IN",
  };

  if (!keep) {
    const data = await tmdbGet("/search/movie", params);
    return shapeList(data);
  }

  const matches: any[] = [];
  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const data = await tmdbGet("/search/movie", { ...params, page: String(page) });
    for (const m of Array.isArray(data.results) ? data.results : []) {
      if (keep.has(m.original_language)) matches.push(m);
    }
    const upstreamPages = Number(data.total_pages) || 1;
    if (matches.length >= SEARCH_LIMIT || page >= upstreamPages) break;
  }

  return shapeList({ results: matches.slice(0, SEARCH_LIMIT) });
}

/**
 * One honest page of results.
 *
 * TMDB's `total_results` is deliberately not forwarded. It counts the films the
 * language filter just removed, so a search that returns two Tamil titles would
 * otherwise report "1,543 results" - and `total_pages` alongside it would offer
 * a pager across a list this endpoint will never serve. Both numbers describe
 * what we are actually returning.
 */
function shapeList(data: any) {
  const movies = Array.isArray(data?.results) ? data.results.map(shapeMovie) : [];
  return { page: 1, totalPages: 1, totalResults: movies.length, movies };
}

export async function getMovieDetails(id: string | number) {
  const data = await tmdbGet(`/movie/${id}`, { append_to_response: "credits,videos" });
  const shaped = shapeMovie(data);
  return {
    ...shaped,
    runtime: data.runtime ?? null,
    genres: Array.isArray(data.genres) ? data.genres.map((g: any) => g.name) : [],
    trailerKey:
      (Array.isArray(data.videos?.results)
        ? data.videos.results.find((v: any) => v.site === "YouTube" && v.type === "Trailer") ||
          data.videos.results.find((v: any) => v.site === "YouTube")
        : null)?.key ?? null,
    cast: Array.isArray(data.credits?.cast)
      ? data.credits.cast.slice(0, 10).map((c: any) => c.name)
      : [],
  };
}

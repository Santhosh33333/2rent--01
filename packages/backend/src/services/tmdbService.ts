import { env } from "../config/env";

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

const LISTS = ["now_playing", "popular", "upcoming", "top_rated"] as const;
export type MovieList = (typeof LISTS)[number];

export function isMovieList(v: unknown): v is MovieList {
  return typeof v === "string" && (LISTS as readonly string[]).includes(v);
}

export async function getMovieList(list: MovieList, page = 1) {
  const data = await tmdbGet(`/movie/${list}`, { page, region: "IN" });
  return {
    page: data.page ?? page,
    totalPages: data.total_pages ?? 1,
    totalResults: data.total_results ?? 0,
    movies: Array.isArray(data.results) ? data.results.map(shapeMovie) : [],
  };
}

export async function searchMovies(query: string, page = 1) {
  const data = await tmdbGet("/search/movie", { query, page, include_adult: "false", region: "IN" });
  return {
    page: data.page ?? page,
    totalPages: data.total_pages ?? 1,
    totalResults: data.total_results ?? 0,
    movies: Array.isArray(data.results) ? data.results.map(shapeMovie) : [],
  };
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

import { Router } from "express";
import { Request, Response } from "express";
import { searchRateLimiter } from "../middleware/rateLimiter";
import { fetchIndianMovies, moviesConfigured } from "../services/movieService";

/**
 * Public movie catalogue for the landing page and the movie-event picker.
 *
 * Read-only, no user data, so it is safe to expose anonymously - but it proxies
 * a metered third-party API, so it is rate limited like public search and the
 * response is cached upstream for 30 minutes.
 *
 * Handlers use an internal try/catch rather than an async wrapper, matching the
 * rest of this codebase: Express 4 does not forward a rejected promise to the
 * error middleware, so an unwrapped async handler would hang the request until
 * the client timed out.
 */
export async function getNowPlaying(_req: Request, res: Response) {
  try {
    // `configured` is reported separately from the list so the UI can say "set
    // TMDB_API_KEY" instead of rendering an empty grid that reads as "no films
    // are showing", which would be plainly false.
    if (!moviesConfigured()) {
      return res.json({ success: true, data: { configured: false, movies: [] } });
    }
    const movies = await fetchIndianMovies(12);
    return res.json({ success: true, data: { configured: true, ...movies } });
  } catch (err: any) {
    // Upstream failure must not surface as a 5xx to the landing page: a broken
    // TMDB key should degrade to an absent section, not an error page. Empty
    // lists, never placeholder films - a demo title on a live page reads real.
    console.error("[MOVIES] getNowPlaying failed:", err?.message || err);
    return res.json({
      success: true,
      data: { configured: true, nowPlaying: [], upcoming: [] },
    });
  }
}

const router = Router();
router.get("/now-playing", searchRateLimiter, getNowPlaying);

export default router;

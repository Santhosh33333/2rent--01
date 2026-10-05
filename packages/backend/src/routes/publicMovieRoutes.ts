import { Router, Request, Response } from "express";
import { searchRateLimiter } from "../middleware/rateLimiter";
import {
  fetchIndianMovies,
  fetchMoviesForLocation,
  moviesConfigured,
} from "../services/movieService";
import { listIndianRegions } from "../services/indiaRegions";

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

/** Coerces a query parameter to a number, or null when it is not usable. */
function coord(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

export async function getNowPlaying(req: Request, res: Response) {
  try {
    // `configured` is reported separately from the list so the UI can say "set
    // TMDB_API_KEY" instead of rendering an empty grid that reads as "no films
    // are showing", which would be plainly false.
    if (!moviesConfigured()) {
      return res.json({ success: true, data: { configured: false, movies: [] } });
    }

    const lat = coord(req.query.lat);
    const lng = coord(req.query.lng);

    // With a coordinate, the list is region-aware: Tamil and Telugu releases for
    // someone in Tamil Nadu, Malayalam for Kerala, and so on. Without one, it is
    // the national list. An unresolvable coordinate falls back to national
    // rather than guessing a state, which is why resolveIndianRegion reports
    // `inRange` instead of always returning an anchor.
    if (lat !== null && lng !== null) {
      const feed = await fetchMoviesForLocation(lat, lng, 12);
      return res.json({ success: true, data: { configured: true, locationAware: true, ...feed } });
    }

    const movies = await fetchIndianMovies(12);
    return res.json({
      success: true,
      data: { configured: true, locationAware: false, ...movies },
    });
  } catch (err: any) {
    // Upstream failure must not surface as a 5xx to the landing page: a broken
    // TMDB key should degrade to an absent section, not an error page. Empty
    // lists, never placeholder films - a demo title on a live page reads real.
    console.error("[MOVIES] getNowPlaying failed:", err?.message || err);
    return res.json({
      success: true,
      data: {
        configured: true,
        nowPlaying: [],
        comingSoon: [],
        upcoming: [],
        stale: true,
      },
    });
  }
}

/** States the location resolver knows, for a picker when GPS is declined. */
export async function getRegions(_req: Request, res: Response) {
  return res.json({ success: true, data: { regions: listIndianRegions() } });
}

const router = Router();
router.get("/now-playing", searchRateLimiter, getNowPlaying);
router.get("/regions", searchRateLimiter, getRegions);

export default router;
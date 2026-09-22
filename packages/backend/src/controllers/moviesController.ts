import { Response } from "express";
import { prisma } from "../config/database";
import { AuthedRequest } from "../middleware/authTypes";
import { sendSuccess, sendError } from "../utils/response";
import {
  isMoviesConfigured,
  moviesConfigError,
  isMovieList,
  getMovieList,
  searchMovies,
  getMovieDetails,
} from "../services/tmdbService";

function notConfigured(res: Response): void {
  const info = moviesConfigError();
  sendError(res, `${info.message} Required env: ${info.requiredEnv.join(", ")}.`, 503, "MOVIES_NOT_CONFIGURED");
}

export async function listMovies(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!isMoviesConfigured()) {
      notConfigured(res);
      return;
    }
    const list = req.params.list;
    if (!isMovieList(list)) {
      sendError(res, "List must be now_playing, popular, upcoming or top_rated.", 400, "VALIDATION_ERROR");
      return;
    }
    const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
    const data = await getMovieList(list, page);
    sendSuccess(res, data, "Movies retrieved.");
  } catch (err: any) {
    console.error("[movies] list error:", err?.message);
    sendError(res, "Movie provider is unreachable right now. Try again later.", 502, "MOVIE_PROVIDER_ERROR");
  }
}

export async function searchMoviesHandler(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!isMoviesConfigured()) {
      notConfigured(res);
      return;
    }
    const q = String(req.query.q || "").trim();
    if (q.length < 2) {
      sendError(res, "Search needs at least 2 characters.", 400, "VALIDATION_ERROR");
      return;
    }
    const page = Math.min(50, Math.max(1, Number(req.query.page) || 1));
    const data = await searchMovies(q, page);
    sendSuccess(res, data, "Movie search results.");
  } catch (err: any) {
    console.error("[movies] search error:", err?.message);
    sendError(res, "Movie provider is unreachable right now. Try again later.", 502, "MOVIE_PROVIDER_ERROR");
  }
}

export async function movieDetails(req: AuthedRequest, res: Response): Promise<void> {
  try {
    if (!isMoviesConfigured()) {
      notConfigured(res);
      return;
    }
    const data = await getMovieDetails(req.params.id);
    sendSuccess(res, data, "Movie details.");
  } catch (err: any) {
    console.error("[movies] details error:", err?.message);
    sendError(res, "Movie provider is unreachable right now. Try again later.", 502, "MOVIE_PROVIDER_ERROR");
  }
}

export async function moviesStatus(_req: AuthedRequest, res: Response): Promise<void> {
  const info = moviesConfigError();
  sendSuccess(
    res,
    isMoviesConfigured()
      ? { configured: true, provider: "TMDB" }
      : { configured: false, provider: "TMDB", requiredEnv: info.requiredEnv },
    "Movies integration status."
  );
}

// Watchlist works WITHOUT the provider (ids + snapshots), so users can
// save movies from any surface and browse them offline from TMDB outages.
export async function getWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const items = await prisma.movieWatchlist.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    sendSuccess(res, { count: items.length, movies: items }, "Watchlist retrieved.");
  } catch (err: any) {
    sendError(res, "Failed to load watchlist.", 500, "INTERNAL_ERROR");
  }
}

export async function addToWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const tmdbId = Number(req.body?.tmdbId);
    const title = String(req.body?.title || "").trim().slice(0, 200);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !title) {
      sendError(res, "tmdbId and title are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const item = await prisma.movieWatchlist.upsert({
      where: { userId_tmdbId: { userId: req.user!.userId, tmdbId } },
      update: {
        title,
        posterUrl: typeof req.body?.posterUrl === "string" ? req.body.posterUrl.slice(0, 500) : undefined,
        releaseDate: typeof req.body?.releaseDate === "string" ? req.body.releaseDate.slice(0, 32) : undefined,
      },
      create: {
        userId: req.user!.userId,
        tmdbId,
        title,
        posterUrl: typeof req.body?.posterUrl === "string" ? req.body.posterUrl.slice(0, 500) : null,
        releaseDate: typeof req.body?.releaseDate === "string" ? req.body.releaseDate.slice(0, 32) : null,
      },
    });
    sendSuccess(res, item, "Saved to watchlist.", 201);
  } catch (err: any) {
    sendError(res, "Failed to save.", 500, "INTERNAL_ERROR");
  }
}

export async function removeFromWatchlist(req: AuthedRequest, res: Response): Promise<void> {
  try {
    const tmdbId = Number(req.params.tmdbId);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
      sendError(res, "Invalid movie id.", 400, "VALIDATION_ERROR");
      return;
    }
    await prisma.movieWatchlist.deleteMany({ where: { userId: req.user!.userId, tmdbId } });
    sendSuccess(res, undefined, "Removed from watchlist.");
  } catch (err: any) {
    sendError(res, "Failed to remove.", 500, "INTERNAL_ERROR");
  }
}

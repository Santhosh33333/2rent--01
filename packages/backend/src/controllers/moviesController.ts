import { Response } from "express";
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

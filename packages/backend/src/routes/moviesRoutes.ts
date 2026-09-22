import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import * as moviesController from "../controllers/moviesController";

const router = Router();

router.use(authenticateToken);

router.get("/status", moviesController.moviesStatus);
router.get("/watchlist", moviesController.getWatchlist);
router.post(
  "/watchlist",
  moviesController.addToWatchlist
);
router.delete("/watchlist/:tmdbId", moviesController.removeFromWatchlist);
router.get("/search", moviesController.searchMoviesHandler);
router.get("/:list", moviesController.listMovies);
router.get("/:id/details", moviesController.movieDetails);

export default router;

import { Router } from "express";
import { searchRateLimiter } from "../middleware/rateLimiter";
import {
  getPublicEventById,
  getPublicEvents,
} from "../controllers/publicEventsController";
import { getEventCategories } from "../controllers/eventController";

// Public, read-only event feed for the marketing site.
//
// Deliberately mounted OUTSIDE the authenticated `/api/events` router: an
// anonymous visitor must be able to see that real events exist and open one,
// without an account. Writes (register, cancel, check-in, create) are not
// exposed here, so joining still requires signing in.
//
// `searchRateLimiter` rather than nothing: this is an unauthenticated read
// endpoint over a table anyone can enumerate, so it gets the same budget as
// public search.
const router = Router();

// Declared before "/:id" on purpose: Express matches in registration order, so
// a later "/categories" would be swallowed by "/:id" and treated as an event
// lookup. The public /events page needs the category list to render its filter
// pills, and the whole authenticated /api/events router sits behind
// authenticateToken + requireKycVerified, which used to 401 this call and
// bounce anonymous visitors to /login mid-load.
//
// Categories are static configuration (key, label, icon, enabled) with no user
// or event data attached, so exposing them costs nothing and leaks nothing.
router.get("/categories", getEventCategories);

router.get("/", searchRateLimiter, getPublicEvents);
router.get("/:id", searchRateLimiter, getPublicEventById);

export default router;

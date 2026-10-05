import { env } from "../config/env";
import { syncMovieFeed } from "./movieService";
import { msUntilIstMidnight } from "./istMidnight";

export { msUntilIstMidnight };

/**
 * Keeps the film catalogue current on its own, without anyone asking.
 *
 * WHY A MIDNIGHT SCHEDULE AND NOT JUST A SHORT CACHE
 * ---------------------------------------------------
 * A 30 minute cache already makes the lists look fresh to a visitor, so it looks
 * like the problem is solved. It is not: the cache is only ever filled by a
 * request. If nobody opens the app at 11:58 PM, the shelf at 12:01 AM is still
 * whatever was fetched at 9 AM, and a film that opened that morning has no
 * poster, no overview and no date until the first person happens to look. The
 * release window is meant to guarantee a title is present *before* its release
 * day, and only a push does that.
 *
 * So the schedule is a daily refresh at the IST day boundary, plus a periodic
 * top-up inside the day to pick up titles TMDB adds late (a date is often
 * confirmed days after a film is first announced, and the coming-soon window
 * only helps if it is actually being pulled).
 *
 * Runs at 12:00 AM IST because that is the moment the "coming soon" list has to
 * change: the film that was 0 days away becomes playing, and the one 8 days out
 * enters the window.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A timer that fires once at the next IST midnight and then re-arms.
 *
 * `setInterval` on a 24 hour period drifts, and a plain `setTimeout` would fire
 * exactly once and then never again. Re-arming after each run keeps the
 * boundary correct across DST-free but leap-second-prone clocks, and across the
 * process being restarted in between.
 */
function scheduleNextMidnight(run: () => Promise<void>): ReturnType<typeof setTimeout> {
  const timer = setTimeout(async () => {
    await run();
    // Re-arm from now, not from the intended boundary, so a slow upstream call
    // cannot make the next fire land in the middle of the afternoon.
    scheduleNextMidnight(run);
  }, msUntilIstMidnight());
  timer.unref?.();
  return timer;
}

let midnightTimer: ReturnType<typeof setTimeout> | null = null;
let topUpTimer: ReturnType<typeof setInterval> | null = null;

export function startMovieCatalogSync(): void {
  if (!env.TMDB_API_KEY) {
    console.log("[MOVIES] TMDB_API_KEY not set; catalogue sync disabled.");
    return;
  }

  const run = async (label: string) => {
    try {
      const result = await syncMovieFeed();
      console.log(
        `[MOVIES] ${label} sync: ${result.ok ? "ok" : "upstream unreachable"}, ` +
          `${result.comingSoon} title(s) inside the coming-soon window`
      );
    } catch (err) {
      console.error(`[MOVIES] ${label} sync failed:`, (err as Error)?.message ?? err);
    }
  };

  // Warm the cache at boot so the first visitor does not wait on TMDB.
  void run("boot");

  midnightTimer = scheduleNextMidnight(() => run("midnight"));

  const topUpMs = env.TMDB_SYNC_INTERVAL_MINUTES * 60 * 1000;
  topUpTimer = setInterval(() => void run("top-up"), topUpMs);
  topUpTimer.unref?.();

  console.log(
    `[MOVIES] catalogue sync armed: next 00:00 IST midnight in ` +
      `${Math.round(msUntilIstMidnight() / 60000)} min, top-up every ${env.TMDB_SYNC_INTERVAL_MINUTES} min.`
  );
}

export function stopMovieCatalogSync(): void {
  if (midnightTimer) clearTimeout(midnightTimer);
  if (topUpTimer) clearInterval(topUpTimer);
  midnightTimer = null;
  topUpTimer = null;
}

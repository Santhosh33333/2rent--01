/**
 * What the Movies page actually shows, per tab, against the live API.
 *
 * The bug this exists to check: `getMovieList` used to forward TMDB's curated
 * `/movie/{now_playing,popular,upcoming,top_rated}` lists. Those are global
 * charts - `region=IN` does not filter them - so the tab answered "Now Playing"
 * with Resident Evil and Spider-Man, and "Upcoming" kept listing films that had
 * already opened. The tabs are now date ranges defined in movieService, and this
 * is the end-to-end check that each one holds.
 *
 * It calls the service, not a re-implementation of it, so the only way to get a
 * clean result is for the endpoint `/api/movies/:list` to actually be clean.
 *
 * Run from packages/backend:  npx tsx scripts/probe-movie-tabs.ts
 */
import 'dotenv/config';
import { getMovieList, searchMovies } from '../src/services/tmdbService.js';

const IST = 'Asia/Kolkata';

function todayIso(offsetDays = 0): string {
  const shifted = new Date(Date.now() + offsetDays * 864e5);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}

const TODAY = todayIso();
const TABS = ['now_playing', 'popular', 'upcoming', 'top_rated'] as const;

/** What each tab is allowed to contain, as a day range from today. */
const BOUNDS: Record<(typeof TABS)[number], [number, number]> = {
  now_playing: [-45, 0],
  popular: [-90, 0],
  upcoming: [1, 120],
  top_rated: [-365, -31],
};

function daysBetween(dateIso: string): number {
  return Math.round((Date.parse(`${dateIso}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 864e5);
}

let problems = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (!ok) problems++;
  console.log(`  [${ok ? 'ok ' : 'FAIL'}] ${label}${detail ? ` - ${detail}` : ''}`);
}

async function main(): Promise<void> {
  console.log(`today (IST) = ${TODAY}\n`);

  for (const tab of TABS) {
    const [minDay, maxDay] = BOUNDS[tab];
    const started = Date.now();
    const data = await getMovieList(tab);
    const ms = Date.now() - started;

    console.log(
      `=== ${tab} - ${data.movies.length} film(s), page ${data.page}/${data.totalPages}, ${ms}ms ===`,
    );
    for (const m of data.movies.slice(0, 6)) {
      console.log(`    ${m.releaseDate}  ${m.title.padEnd(38)} [${m.language}] ${m.rating ?? '-'}`);
    }

    const [lo, hi] = [todayIso(minDay), todayIso(maxDay)];
    check('totalResults matches the list', data.totalResults === data.movies.length);
    check('reports a single real page', data.totalPages === 1);
    check('not empty', data.movies.length > 0, `${data.movies.length}`);

    const outOfRange = data.movies.filter((m) => m.releaseDate < lo || m.releaseDate > hi);
    check(
      `every film released ${minDay}..${maxDay} days from today`,
      outOfRange.length === 0,
      outOfRange.map((m) => `${m.releaseDate} ${m.title}`).join('; '),
    );

    if (tab === 'upcoming') {
      // The complaint that started this: a film that has already opened must not
      // still be sitting on a future shelf.
      const alreadyReleased = data.movies.filter((m) => daysBetween(m.releaseDate) < 1);
      check(
        'nothing already released on a future shelf',
        alreadyReleased.length === 0,
        alreadyReleased.map((m) => `${m.releaseDate} ${m.title}`).join('; '),
      );
    } else {
      // The mirror image: these shelves are about released films, so a date in
      // the future means the range did not hold.
      const notYetReleased = data.movies.filter((m) => daysBetween(m.releaseDate) > 0);
      check(
        'nothing unreleased on a shelf about released films',
        notYetReleased.length === 0,
        notYetReleased.map((m) => `${m.releaseDate} ${m.title}`).join('; '),
      );
      // And for top_rated specifically, the 31 day floor is what keeps a film
      // with two votes off a chart of films people have seen.
      if (tab === 'top_rated') {
        const tooFresh = data.movies.filter((m) => daysBetween(m.releaseDate) > -31);
        check(
          'nothing rated under a month old on the top-rated shelf',
          tooFresh.length === 0,
          tooFresh.map((m) => `${m.releaseDate} ${m.title}`).join('; '),
        );
      }
    }

    const nonTamil = data.movies.filter((m) => m.language !== 'ta');
    check(
      'every film is Tamil',
      nonTamil.length === 0,
      nonTamil.map((m) => `${m.language} ${m.title}`).join('; '),
    );

    const undated = data.movies.filter((m) => !m.releaseDate);
    check('every film has a release date', undated.length === 0);

    const noBooking = data.movies.filter((m) => !/^https:\/\//.test(m.bookingUrl || ''));
    check('every film has an absolute booking link', noBooking.length === 0);

    const search404 = data.movies.filter((m) => (m.bookingUrl || '').includes('/search'));
    check('no BookMyShow /search links (they 404)', search404.length === 0);

    const dupes = data.movies.length - new Set(data.movies.map((m) => m.id)).size;
    check('no duplicate titles', dupes === 0, `${dupes}`);

    console.log('');
  }

  // The search box sits above a Tamil-only shelf, so it has to rank Tamil titles
  // the same way. Typed a real Tamil release that used to be buried under
  // Hollywood and Arabic matches with a similar name.
  console.log('=== search "jailer" (language filter applied server-side) ===');
  try {
    const found = await searchMovies('jailer');
    console.log(`  matches returned: ${found.totalResults}`);
    for (const m of found.movies.slice(0, 5)) {
      console.log(`    ${m.releaseDate}  ${m.title.padEnd(38)} [${m.language}]`);
    }
    check('search returns something', found.movies.length > 0);
    check(
      'every search hit is a language this catalogue lists',
      found.movies.every((m) => m.language === 'ta'),
      found.movies.filter((m) => m.language !== 'ta').map((m) => `${m.language} ${m.title}`).join('; '),
    );
    check(
      'does not report TMDB global totals for the rows it removed',
      found.totalResults === found.movies.length,
      `reported ${found.totalResults} for ${found.movies.length} rows`,
    );
  } catch (err) {
    check('search did not throw', false, (err as Error).message);
  }

  console.log(`\n${problems === 0 ? 'ALL CHECKS PASSED' : `${problems} CHECK(S) FAILED`}`);
  process.exit(problems === 0 ? 0 : 1);
}

void main();
/**
 * Which ordering makes "coming soon" both current AND worth looking at?
 *
 * Sorting the future shelf by date ascending gives the earliest releases first,
 * which is what a cinema audience wants - but page 1 of a date-sorted query is
 * dominated by long-tail titles TMDB has almost no data for (a Bhutanese tunnel
 * film, a Nepali short, a South African documentary tagged as Indian). Sorting
 * by popularity fixes the noise and loses the "what opens next week" ordering.
 *
 * This measures both so the choice is made on real output rather than taste.
 *
 * Run from packages/backend:  npx tsx scripts/probe-comingsoon.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readKey(): string {
  const fromEnv = process.env.TMDB_API_KEY;
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    const m = text.match(/^TMDB_API_KEY=(.*)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

const KEY = readKey();
if (!KEY) {
  console.error('TMDB_API_KEY not found.');
  process.exit(1);
}

const BASE = 'https://api.themoviedb.org/3';
const IST = 'Asia/Kolkata';

async function get(path: string, params: Record<string, string> = {}, attempts = 4) {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('language', 'en');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url.toString(), { signal: ctrl.signal });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      return (await res.json()) as any;
    } catch (err) {
      lastErr = err;
      console.error(`  [retry ${attempt}/${attempts}] ${(err as Error).message}`);
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1200));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

function istDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() + offsetDays * 864e5));
}

function daysOut(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(d)) return null;
  return Math.round((d - Date.parse(`${istDay(0)}T00:00:00Z`)) / 864e5);
}

const BASE_PARAMS = {
  region: 'IN',
  with_origin_country: 'IN',
  with_release_type: '2|3',
  include_adult: 'false',
  include_video: 'false',
  'primary_release_date.gte': istDay(1),
  'primary_release_date.lte': istDay(120),
};

async function show(label: string, data: any) {
  const soon = data.results.filter((m: any) => (daysOut(m.release_date) ?? 999) <= 7);
  console.log(`\n--- ${label} ---`);
  console.log(`  page 1 has ${data.results.length} title(s); ${soon.length} open within 7 days`);
  if (!soon.length) {
    console.log('  (nothing inside the coming-soon window - the shelf would render empty)');
  }
  for (const m of soon.slice(0, 8)) {
    console.log(
      `    +${String(daysOut(m.release_date)).padStart(3)}d  pop=${String(m.popularity).padStart(7)}  votes=${String(m.vote_count).padStart(5)}  ${m.title}`
    );
  }
  if (!soon.length) {
    const first = data.results.slice(0, 5);
    console.log('  nearest releases in this page instead:');
    for (const m of first) {
      console.log(
        `    +${String(daysOut(m.release_date)).padStart(3)}d  pop=${String(m.popularity).padStart(7)}  votes=${String(m.vote_count).padStart(5)}  ${m.title}`
      );
    }
  }
}

async function main() {
  const today = istDay(0);
  console.log(`today (IST): ${today}`);

  const byDate = await get('/discover/movie', { ...BASE_PARAMS, sort_by: 'primary_release_date.asc', page: '1' });
  await show('A: date ascending (current behaviour)', byDate);

  const byPop = await get('/discover/movie', { ...BASE_PARAMS, sort_by: 'popularity.desc', page: '1' });
  await show('B: popularity descending', byPop);

  // C: popularity over a wider pool, then date-sorted locally - the "best of
  // both" option, at the cost of a second upstream request.
  const pool = [...byPop.results];
  const page2 = await get('/discover/movie', { ...BASE_PARAMS, sort_by: 'popularity.desc', page: '2' });
  pool.push(...page2.results);
  const seen = new Set<number>();
  const deduped = pool.filter((m: any) => !seen.has(m.id) && seen.add(m.id));
  const cSoon = deduped
    .filter((m: any) => (daysOut(m.release_date) ?? 999) <= 7)
    .sort((a: any, b: any) => a.release_date.localeCompare(b.release_date));
  console.log(`\n--- C: popularity pool (${deduped.length} titles), date-sorted locally ---`);
  console.log(`  ${cSoon.length} open within 7 days`);
  for (const m of cSoon.slice(0, 8)) {
    console.log(
      `    +${String(daysOut(m.release_date)).padStart(3)}d  pop=${String(m.popularity).padStart(7)}  votes=${String(m.vote_count).padStart(5)}  ${m.title}`
    );
  }

  console.log('\n--- overlap between A and B page 1 ---');
  const aIds = new Set(byDate.results.map((m: any) => m.id));
  const shared = byPop.results.filter((m: any) => aIds.has(m.id)).length;
  console.log(`  ${shared} of ${byPop.results.length} popularity titles appear in the date-sorted page`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

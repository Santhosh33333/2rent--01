/**
 * One-off diagnostic: does the fixed query actually return current films?
 *
 * Answers the report that the Movies shelf looked frozen. Prints the old query
 * and the new one side by side against live TMDB so the difference is visible
 * rather than asserted.
 *
 * Run from packages/backend:  npx tsx scripts/probe-movies.ts
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

/**
 * TMDB resets connections from this network intermittently, so retry. The
 * service does the same (see fetchDiscover) - a probe that gives up on the first
 * ECONNRESET would report a network problem as a data problem.
 */
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

/** Days from today to an ISO date. Negative = already released. */
function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(d)) return null;
  return Math.round((d - Date.parse(`${istDay(0)}T00:00:00Z`)) / 864e5);
}

/** Human label for a day offset: "12d ago", "in 3d", or "?". */
function when(iso: string | null | undefined): string {
  const n = daysFromToday(iso);
  if (n === null) return 'unknown';
  return n < 0 ? `${-n}d ago` : n === 0 ? 'today' : `in ${n}d`;
}

async function main() {
  const today = istDay(0);
  const base = {
    region: 'IN',
    with_origin_country: 'IN',
    with_release_type: '2|3',
    include_adult: 'false',
    include_video: 'false',
  };

  console.log(`today (IST): ${today}\n`);

  console.log('=== OLD now-playing query: no lower bound, popularity desc ===');
  const old = await get('/discover/movie', {
    ...base,
    'primary_release_date.lte': today,
    sort_by: 'popularity.desc',
    page: '1',
  });
  for (const m of old.results.slice(0, 12)) {
    console.log(`  ${m.release_date}  ${when(m.release_date).padStart(8)}  pop=${String(m.popularity).padStart(8)}  ${m.title}`);
  }
  const oldAges = old.results.slice(0, 12).map((m: any) => -(daysFromToday(m.release_date) ?? -9999));
  console.log(`  oldest title in the top 12: ${Math.max(...oldAges)} days old`);

  console.log('\n=== NEW now-playing query: bounded to 45 days, popularity desc ===');
  const now = await get('/discover/movie', {
    ...base,
    'primary_release_date.gte': istDay(-45),
    'primary_release_date.lte': today,
    sort_by: 'popularity.desc',
    page: '1',
  });
  for (const m of now.results.slice(0, 12)) {
    console.log(`  ${m.release_date}  ${when(m.release_date).padStart(8)}  pop=${String(m.popularity).padStart(8)}  ${m.title}`);
  }
  const newAges = now.results.slice(0, 12).map((m: any) => -(daysFromToday(m.release_date) ?? -9999));
  console.log(`  oldest title in the top 12: ${Math.max(...newAges)} days old`);
  console.log(`  titles dropped by the bound: ${old.results
    .slice(0, 12)
    .filter((m: any) => !(now.results.slice(0, 12) as any[]).some((n) => n.id === m.id))
    .map((m: any) => `${m.title} (${m.release_date})`)
    .join(', ') || 'none'}`);
  console.log(`  titles added by the bound:   ${now.results
    .slice(0, 12)
    .filter((m: any) => !(old.results.slice(0, 12) as any[]).some((o) => o.id === m.id))
    .map((m: any) => `${m.title} (${m.release_date})`)
    .join(', ') || 'none'}`);

  console.log('\n=== NEW coming-soon query: starts tomorrow (no overlap with today) ===');
  const soon = await get('/discover/movie', {
    ...base,
    'primary_release_date.gte': istDay(1),
    'primary_release_date.lte': istDay(120),
    sort_by: 'primary_release_date.asc',
    page: '1',
  });
  for (const m of soon.results.slice(0, 10)) {
    console.log(`  ${m.release_date}  ${when(m.release_date).padStart(8)}  ${m.title}`);
  }
  const todayInSoon = soon.results.filter((m: any) => m.release_date === today);
  console.log(`  films dated today leaking into coming soon: ${todayInSoon.length} (must be 0)`);

  const nowIds = new Set(now.results.slice(0, 12).map((m: any) => m.id));
  const overlap = soon.results
    .slice(0, 12)
    .filter((m: any) => nowIds.has(m.id))
    .map((m: any) => m.title);
  console.log(`  titles on both shelves: ${overlap.join(', ') || 'none'}`);

  console.log('\n=== booking link check ===');
  for (const u of ['https://in.bookmyshow.com/search?q=Meesaya', 'https://in.bookmyshow.com/movies']) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 15000);
      const res = await fetch(u, {
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131 Safari/537.36' },
      });
      clearTimeout(t);
      console.log(`  ${res.status}  ${u}`);
    } catch (e) {
      console.log(`  ERR ${(e as Error).message}  ${u}`);
    }
  }
  console.log('  (403 here means bot-blocking from this network, not that a browser 404s)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

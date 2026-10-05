/**
 * Is there enough Tamil on TMDB to build a Tamil-first shelf?
 *
 * The catalogue is currently every Indian theatrical release, which for a
 * Chennai audience is a lot of Hindi, Malayalam, Kannada and Nepali titles.
 * Before switching the default to Tamil this measures whether the shelves would
 * actually have anything in them, and how much a Tamil-language filter costs
 * against the national list.
 *
 * Also checks the "ta plus en" merge, because TMDB tags plenty of Indian
 * theatrical releases as English or leaves the language blank, so a strict
 * `with_original_language=ta` filter may quietly drop real Tamil films.
 *
 * Run from packages/backend:  npx tsx scripts/probe-tamil.ts
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

const SHELVES = [
  { label: 'now playing (-45d..today)', gte: istDay(-45), lte: istDay(0) },
  { label: 'coming soon (t..+7d)', gte: istDay(1), lte: istDay(7) },
  { label: 'upcoming (+8d..+120d)', gte: istDay(8), lte: istDay(120) },
];

const NATIONAL = {
  region: 'IN',
  with_origin_country: 'IN',
  with_release_type: '2|3',
  include_adult: 'false',
  include_video: 'false',
};

function langLabel(code: string | null | undefined): string {
  const names: Record<string, string> = {
    ta: 'Tamil', hi: 'Hindi', ml: 'Malayalam', kn: 'Kannada', te: 'Telugu',
    bn: 'Bengali', ne: 'Nepali', ks: 'Kashmiri', dz: 'Dzongkha', mr: 'Marathi',
    gu: 'Gujarati', pa: 'Punjabi', ur: 'Urdu', or: 'Odia', as: 'Assamese',
    si: 'Sinhala', en: 'English',
  };
  return names[String(code)] ?? String(code ?? 'unset');
}

async function main() {
  console.log(`today (IST): ${istDay(0)}\n`);

  for (const shelf of SHELVES) {
    console.log(`\n=== ${shelf.label} ===`);

    const range = { 'primary_release_date.gte': shelf.gte, 'primary_release_date.lte': shelf.lte };

    const national = await get('/discover/movie', {
      ...NATIONAL, ...range, sort_by: 'popularity.desc', page: '1',
    });
    const tamil = await get('/discover/movie', {
      ...NATIONAL, with_original_language: 'ta', ...range, sort_by: 'popularity.desc', page: '1',
    });
    const english = await get('/discover/movie', {
      ...NATIONAL, with_original_language: 'en', ...range, sort_by: 'popularity.desc', page: '1',
    });

    const langCounts = new Map<string, number>();
    for (const m of national.results) {
      const l = langLabel(m.original_language);
      langCounts.set(l, (langCounts.get(l) ?? 0) + 1);
    }

    console.log(`  page 1 sizes: national=${national.results.length}  ta=${tamil.results.length}  en=${english.results.length}`);
    console.log(`  national page 1 by language: ${[...langCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  ')}`);

    const merged = [...tamil.results, ...english.results].filter(
      (m: any, i: number, arr: any[]) => arr.findIndex((o) => o.id === m.id) === i
    );
    console.log(`  ta+en merged, deduped: ${merged.length}`);

    if (tamil.results.length === 0) {
      console.log('  !! Tamil page is EMPTY - a Tamil-only default would render an empty shelf');
    } else {
      console.log('  Tamil titles:');
      for (const m of tamil.results.slice(0, 8)) {
        console.log(`    ${m.release_date}  pop=${String(m.popularity).padStart(7)}  ${m.title}`);
      }
    }
  }

  // Does a Tamil filter lose titles the national list has, that are clearly Tamil?
  console.log('\n=== how many national titles are Tamil? ===');
  const all = await get('/discover/movie', {
    ...NATIONAL,
    'primary_release_date.gte': istDay(-45),
    'primary_release_date.lte': istDay(0),
    sort_by: 'popularity.desc',
    page: '1',
  });
  const taCount = all.results.filter((m: any) => m.original_language === 'ta').length;
  console.log(`  ${taCount} of ${all.results.length} on page 1 are tagged Tamil`);

  const byRegionTa = await get('/discover/movie', {
    region: 'IN',
    with_release_type: '2|3',
    include_adult: 'false',
    include_video: 'false',
    'primary_release_date.gte': istDay(-45),
    'primary_release_date.lte': istDay(0),
    with_original_language: 'ta',
    sort_by: 'popularity.desc',
    page: '1',
  });
  console.log(`  Tamil WITHOUT the origin-country filter: ${byRegionTa.results.length}`);
  console.log('  (a higher number means the origin filter is excluding Tamil films tagged otherwise)');
  for (const m of byRegionTa.results.slice(0, 10)) {
    console.log(`    ${m.release_date}  ${langLabel(m.original_language).padEnd(9)} ${m.title}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

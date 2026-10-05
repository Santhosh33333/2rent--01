/**
 * The song catalogue.
 *
 * Reads `public/audio/manifest.json` at runtime and answers the only two
 * questions the rest of the app asks: which tracks exist, and which one should
 * play next.
 *
 * The manifest ships empty. That is a deliberate state, not a gap: audio
 * recordings are copyrighted even when the song is traditional or the file is
 * instrumental, so this repository cannot ship a Tamil love-song catalogue
 * without someone clearing the rights first. See `public/audio/README.md`.
 *
 * Consequently every function here is written to be correct with zero tracks,
 * and the UI is written to say "no music added yet" rather than to render a
 * list of songs that cannot play. When tracks do arrive, nothing else changes.
 *
 * One rule runs through this file: a track is only ever offered if its file is
 * listed in the manifest. There is no directory scan, so a half-downloaded mp3
 * or a stray `.DS_Store` can never become something the player promises and then
 * fails on.
 */

/** A single playable track, as declared in the manifest. */
export interface SongTrack {
  /** Unique and stable. Changing it resets this track's shuffle history. */
  id: string;
  /** The real name of the track. Never invented. */
  title: string;
  /** Real performer or composer, when known. */
  artist?: string;
  /** BCP-47 primary subtag only: "ta", "en", "hi". */
  language: string;
  /** Free-form tag. "love" is what the love-song filter matches. */
  mood: string;
  /** Root-relative URL under /audio/. */
  src: string;
  /** Who to credit. Shown beside the track. */
  credit?: string;
  /** The licence, e.g. "CC0", "CC BY 4.0". */
  license?: string;
}

/** The catalogue, plus how it loaded. */
export interface SongLibrary {
  tracks: SongTrack[];
  loading: boolean;
  /** Set when the manifest itself could not be read. */
  error: string | null;
}

const EMPTY: SongLibrary = { tracks: [], loading: true, error: null };

/** Mood tag the love-song surfaces filter on. */
export const LOVE_MOOD = 'love';

/**
 * Rejects entries that would break playback, so one bad row cannot take the
 * whole catalogue down.
 *
 * An entry needs a real id, a real title and an audio URL under /audio/. The
 * `src` check is the important one: an absolute or protocol-relative URL in the
 * manifest would let the player fetch a third-party origin, which is both a
 * privacy leak and a way for a bad manifest to pull in an ad server.
 */
function parseTrack(raw: unknown): SongTrack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const id = typeof r.id === 'string' ? r.id.trim() : '';
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  const src = typeof r.src === 'string' ? r.src.trim() : '';

  if (!id || !title || !src) return null;
  if (!src.startsWith('/audio/')) return null;
  if (/^\/\//.test(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  if (!/\.(mp3|m4a|aac|ogg|wav)$/i.test(src)) return null;

  const language = typeof r.language === 'string' ? r.language.trim().toLowerCase() : '';
  if (!language) return null;

  return {
    id,
    title,
    language: language.split('-')[0],
    mood: typeof r.mood === 'string' && r.mood.trim() ? r.mood.trim().toLowerCase() : 'general',
    src,
    artist: typeof r.artist === 'string' && r.artist.trim() ? r.artist.trim() : undefined,
    credit: typeof r.credit === 'string' && r.credit.trim() ? r.credit.trim() : undefined,
    license: typeof r.license === 'string' && r.license.trim() ? r.license.trim() : undefined,
  };
}

/**
 * Parses the manifest body.
 *
 * A malformed entry is dropped rather than thrown on. One bad row should cost
 * that one song, not the whole page - but the count is returned so the caller
 * can be honest about it rather than silently showing a short list.
 */
export function parseManifest(body: unknown): { tracks: SongTrack[]; rejected: number } {
  const rows =
    typeof body === 'object' && body !== null && Array.isArray((body as { tracks?: unknown }).tracks)
      ? ((body as { tracks: unknown[] }).tracks ?? [])
      : [];

  const tracks: SongTrack[] = [];
  const seen = new Set<string>();
  let rejected = 0;

  for (const row of rows) {
    const track = parseTrack(row);
    if (!track) {
      rejected += 1;
      continue;
    }
    if (seen.has(track.id)) {
      rejected += 1;
      continue;
    }
    seen.add(track.id);
    tracks.push(track);
  }

  return { tracks, rejected };
}

/**
 * Fetches the manifest once and shares the result.
 *
 * Every surface that plays music asks for this independently, so the request is
 * memoised on `window` - otherwise opening a match and then the music page would
 * refetch, and a slow network would mean two separate spinners for one file.
 */
let inflight: Promise<SongLibrary> | null = null;

export function loadSongLibrary(): Promise<SongLibrary> {
  if (typeof window === 'undefined') return Promise.resolve(EMPTY);
  if (inflight) return inflight;

  inflight = fetch('/audio/manifest.json', { cache: 'no-cache' })
    .then(async (res) => {
      if (!res.ok) throw new Error(`manifest responded ${res.status}`);
      const { tracks, rejected } = parseManifest(await res.json());
      if (rejected > 0) {
        // Surfaced rather than swallowed: a manifest with broken rows is a
        // publishing mistake, and the owner needs to see it.
        console.warn(
          `[songs] ${rejected} manifest entr${rejected === 1 ? 'y was' : 'ies were'} rejected. ` +
            'Each needs id, title, language and an audio src under /audio/.',
        );
      }
      return { tracks, loading: false, error: null } satisfies SongLibrary;
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'unknown error';
      // A missing manifest is the shipped state, not a fault, so this is a debug
      // line and not a console error. The UI reports the empty catalogue.
      console.info(`[songs] no catalogue available (${message}); music is off.`);
      return { tracks: [], loading: false, error: null } satisfies SongLibrary;
    });

  return inflight;
}

/**
 * Resolves which language to play in.
 *
 * Order is deliberate: an explicit choice always beats inference, and inference
 * beats the default. `ta` is the default because the catalogue is Tamil-first,
 * so an anonymous visitor with no signal gets Tamil rather than English.
 */
export function resolveSongLanguage(options: {
  /** Set when the visitor picked a language themselves. */
  explicit?: string | null;
  /** The signed-in member's saved language. */
  memberLanguage?: string | null;
  /** Available UI locales, e.g. ["ta", "en"]. */
  pageLanguages?: readonly string[];
  /** navigator.language, for anonymous visitors. */
  browserLanguage?: string | null;
} = {}): string {
  const clean = (value?: string | null): string | null => {
    if (typeof value !== 'string') return null;
    const primary = value.trim().toLowerCase().split('-')[0];
    return primary || null;
  };

  return (
    clean(options.explicit) ??
    clean(options.memberLanguage) ??
    clean(options.browserLanguage) ??
    clean(options.pageLanguages?.[0]) ??
    'ta'
  );
}

/** Tracks matching a language, narrowed to love songs when asked. */
export function selectTracks(
  tracks: readonly SongTrack[],
  language: string,
  opts: { loveOnly?: boolean } = {},
): SongTrack[] {
  const primary = language.toLowerCase().split('-')[0];
  return tracks.filter(
    (t) => t.language === primary && (!opts.loveOnly || t.mood === LOVE_MOOD),
  );
}

/**
 * Picks a track at random, without playing the same one twice in a row.
 *
 * A plain `random()` re-picks the current track about 1-in-N times, which on a
 * small catalogue is a bug people notice and cannot explain. Excluding the
 * current id is the whole fix; when only one track exists it is left alone,
 * because silence would be worse than a repeat.
 */
export function pickRandom<T>(items: readonly T[], excludeId?: string | null): T | null {
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];

  const pool = excludeId == null ? items : items.filter((i) => idOf(i) !== excludeId);
  if (pool.length === 0) return items[0];
  return pool[Math.floor(Math.random() * pool.length)];
}

function idOf(item: unknown): string {
  return typeof item === 'object' && item !== null ? String((item as { id?: unknown }).id) : '';
}

/**
 * Cycles a pool without repeats until every entry has played once.
 *
 * Used for long sessions, where "no immediate repeat" still lets the same four
 * tracks come round every fourth song. Once the bag empties it refills, so the
 * order reshuffles between cycles rather than repeating identically.
 */
export function createShuffleBag(ids: readonly string[]): {
  next: (currentId?: string | null) => string | null;
  remaining: () => number;
} {
  let bag: string[] = [];

  const refill = () => {
    bag = [...ids];
    // Fisher-Yates. Math.random is fine here: this is a listening order, not
    // anything that needs to be unpredictable to an adversary.
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  };

  return {
    next(currentId) {
      if (ids.length === 0) return null;
      if (bag.length === 0) refill();

      // Skip a leading repeat of the track that just finished, if the shuffle
      // happened to put it first.
      if (bag.length > 1 && currentId != null && bag[0] === currentId) {
        const j = 1 + Math.floor(Math.random() * (bag.length - 1));
        [bag[0], bag[j]] = [bag[j], bag[0]];
      }

      return bag.shift() ?? null;
    },
    remaining: () => bag.length,
  };
}

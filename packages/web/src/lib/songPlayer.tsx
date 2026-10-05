/**
 * The song player.
 *
 * One audio element, shared by every surface that plays music, so the landing
 * page, a dating match and an event room are never playing on top of each other.
 *
 * Two constraints shape this file, and both come from the browser rather than
 * from us:
 *
 *   - **Autoplay is blocked.** No browser will start audible audio without a
 *     user gesture. So `play()` is only ever called from a click, and
 *     `blocked` is a real state the UI has to render - a toggle that silently
 *     does nothing is the single most common way a music feature feels broken.
 *   - **`play()` returns a promise that rejects.** Not calling `.catch()` on it
 *     produces an unhandled rejection in the console on every single load. That
 *     is why the rejection is handled and turned into state.
 *
 * Volume is deliberately low and there is no unmute-by-default. Music that
 * starts at full volume on a landing page is an ambush.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  createShuffleBag,
  loadSongLibrary,
  LOVE_MOOD,
  pickRandom,
  resolveSongLanguage,
  selectTracks,
  type SongTrack,
} from './songLibrary';

const PREF_KEY = 'nabri-song-language';
const DISABLED_KEY = 'nabri-music-off';

export interface SongPlayerValue {
  /** The catalogue, including its loading state. */
  tracks: SongTrack[];
  loading: boolean;
  /** The track currently loaded, whether or not it is playing. */
  current: SongTrack | null;
  playing: boolean;
  /** True when the browser refused to start audio and a tap is needed. */
  blocked: boolean;
  /** The visitor has switched music off for this device. */
  mutedByUser: boolean;
  /** The language actually being played. */
  language: string;
  /** True when there is at least one playable track. */
  available: boolean;
  /**
   * Every language that actually has love songs, so a picker can offer only those
   * instead of a list of languages that would all resolve to nothing.
   */
  availableLanguages: string[];
  /** Why nothing is playing, when nothing is. */
  emptyReason: 'loading' | 'no-catalogue' | 'no-language-match' | 'muted' | null;
  /** Plays the current track, or starts the cycle if idle. Call from a gesture. */
  play: () => void;
  /** Plays one specific track. Call from a gesture. */
  playTrack: (track: SongTrack) => void;
  pause: () => void;
  toggle: () => void;
  /** Skips to another track. */
  next: () => void;
  /** Switches language, remembering the choice on this device. */
  setLanguage: (language: string) => void;
  /** Turns music off/on for this device. */
  setMutedByUser: (muted: boolean) => void;
}

const SongPlayerContext = createContext<SongPlayerValue | null>(null);

function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(PREF_KEY);
  } catch {
    // Private browsing can throw on localStorage access. A missing remembered
    // language is a fine outcome.
    return null;
  }
}

function readMutedByUser(): boolean {
  try {
    return window.localStorage.getItem(DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Not worth surfacing: the preference simply will not survive a reload.
  }
}

export function SongPlayerProvider({ children }: { children: ReactNode }) {
  const [allTracks, setAllTracks] = useState<SongTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [language, setLanguageState] = useState<string>(() => resolveSongLanguage({
    explicit: readStoredLanguage(),
    browserLanguage: typeof navigator === 'undefined' ? null : navigator.language,
  }));
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [mutedByUser, setMutedByUserState] = useState<boolean>(() => readMutedByUser());

  // The single audio element. Never rendered: an <audio> in the DOM would let a
  // stray autoplay attribute or a browser media session start it behind the
  // player's back.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // A tag on the requested track, so a slow load resolving after the visitor has
  // already skipped does not start the track they moved on from.
  const pendingIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSongLibrary().then((lib) => {
      if (cancelled) return;
      setAllTracks(lib.tracks);
      setLoading(lib.loading);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // loveOnly on every surface: the brief is love songs, not a general catalogue.
  const pool = useMemo(
    () => selectTracks(allTracks, language, { loveOnly: true }),
    [allTracks, language],
  );

  // loveOnly for consistency with the pool: a language only counts as available if
  // it has love songs, not if its only tracks are some other mood that the player
  // can never reach.
  const availableLanguages = useMemo(
    () => Array.from(new Set(
      allTracks.filter((t) => t.mood === LOVE_MOOD).map((t) => t.language),
    )),
    [allTracks],
  );

  const poolIds = useMemo(() => pool.map((t) => t.id).join('|'), [pool]);
  const bagRef = useRef(createShuffleBag([] as string[]));
  useEffect(() => {
    // Rebuilt when the pool changes, so switching language cannot hand back a
    // track from the language that was just left.
    bagRef.current = createShuffleBag(pool.map((t) => t.id));
  }, [poolIds, pool]);

  const current = useMemo(
    () => pool.find((t) => t.id === currentId) ?? null,
    [pool, currentId],
  );

  /** Loads a track and attempts to play it. Returns nothing; state does the talking. */
  const startTrack = useCallback(
    (track: SongTrack) => {
      const audio = audioRef.current;
      if (!audio) return;

      pendingIdRef.current = track.id;
      setCurrentId(track.id);
      audio.src = track.src;
      audio.currentTime = 0;

      audio.play().then(
        () => {
          // Ignore a resolve for a track the visitor has already skipped past.
          if (pendingIdRef.current !== track.id) return;
          setPlaying(true);
          setBlocked(false);
        },
        () => {
          if (pendingIdRef.current !== track.id) return;
          setPlaying(false);
          // Almost always the autoplay policy. Surfaced so the UI can ask for a
          // tap instead of appearing broken.
          setBlocked(true);
        },
      );
    },
    [],
  );

  /** Chooses a track and plays it. Only ever call from a user gesture. */
  const play = useCallback(() => {
    if (mutedByUser) return;
    if (pool.length === 0) return;

    const nextId = bagRef.current.next(currentId);
    const track = nextId ? pool.find((t) => t.id === nextId) : null;
    if (track) {
      startTrack(track);
      return;
    }
    // Pool emptied between render and click; fall back to a plain pick.
    const fallback = pickRandom(pool, currentId);
    if (fallback) startTrack(fallback);
  }, [pool, currentId, mutedByUser, startTrack]);

  /**
   * Plays a named track, e.g. tapped in a list.
   *
   * Ignores a track outside the active language. A tap on a Tamil track while the
   * player is set to English would otherwise start it and leave the header
   * claiming the wrong language, which is a small lie the UI would be telling.
   */
  const playTrack = useCallback(
    (track: SongTrack) => {
      if (mutedByUser) return;
      if (!pool.some((t) => t.id === track.id)) return;
      startTrack(track);
    },
    [pool, mutedByUser, startTrack],
  );

  const pause = useCallback(() => {
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
      return;
    }
    // Resuming a paused track keeps its position; a fresh cycle only starts when
    // there is nothing loaded.
    const audio = audioRef.current;
    if (current && audio && audio.src && !audio.ended && audio.currentTime > 0) {
      pendingIdRef.current = current.id;
      audio.play().then(
        () => {
          setPlaying(true);
          setBlocked(false);
        },
        () => {
          setBlocked(true);
        },
      );
      return;
    }
    play();
  }, [playing, pause, play, current]);

  const next = useCallback(() => {
    if (pool.length === 0) return;
    const nextId = bagRef.current.next(currentId);
    const track = nextId ? pool.find((t) => t.id === nextId) : null;
    if (track) startTrack(track);
  }, [pool, currentId, startTrack]);

  // Advance on natural end. `ended` fires on the element, not in React state, so
  // this is an event listener rather than an effect on `playing`.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => {
      if (mutedByUser) return;
      const nextId = bagRef.current.next(pendingIdRef.current);
      const track = nextId ? pool.find((t) => t.id === nextId) : null;
      if (track) startTrack(track);
      else setPlaying(false);
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [pool, mutedByUser, startTrack]);

  const setLanguage = useCallback((next: string) => {
    const primary = next.trim().toLowerCase().split('-')[0];
    if (!primary) return;
    writeStored(PREF_KEY, primary);
    setLanguageState(primary);
    // The current track is in the old language. Stop rather than keep playing
    // something that no longer matches the choice.
    pause();
    setCurrentId(null);
    setBlocked(false);
  }, [pause]);

  const setMutedByUser = useCallback(
    (muted: boolean) => {
      writeStored(DISABLED_KEY, String(muted));
      setMutedByUserState(muted);
      if (muted) {
        pause();
        setCurrentId(null);
      }
    },
    [pause],
  );

  // Stop when the tab is hidden. Nobody wants a landing page's music following
  // them into another tab, and a backgrounded tab is throttled anyway.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        audioRef.current?.pause();
        setPlaying(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Stop on unmount. Without this an in-flight play() can outlive the provider.
  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      audio?.removeAttribute('src');
    };
  }, []);

  const value = useMemo<SongPlayerValue>(() => {
    const available = pool.length > 0;
    const emptyReason: SongPlayerValue['emptyReason'] = loading
      ? 'loading'
      : !available && allTracks.length === 0
        ? 'no-catalogue'
        : !available
          ? 'no-language-match'
          : mutedByUser
            ? 'muted'
            : null;

    return {
      tracks: pool,
      loading,
      current,
      playing,
      blocked,
      mutedByUser,
      language,
      available,
      availableLanguages,
      emptyReason,
      play,
      playTrack,
      pause,
      toggle,
      next,
      setLanguage,
      setMutedByUser,
    };
  }, [
    pool,
    allTracks.length,
    loading,
    current,
    playing,
    blocked,
    mutedByUser,
    language,
    availableLanguages,
    play,
    playTrack,
    pause,
    toggle,
    next,
    setLanguage,
    setMutedByUser,
  ]);

  return (
    <SongPlayerContext.Provider value={value}>
      {/*
        Not in the document flow and with no controls, so it is invisible and
        cannot be operated except through the player's own UI. preload="none"
        keeps it from fetching a track before anyone asks for one.
      */}
      <audio ref={audioRef} preload="none" style={{ display: 'none' }} />
      {children}
    </SongPlayerContext.Provider>
  );
}

export function useSongPlayer(): SongPlayerValue {
  const ctx = useContext(SongPlayerContext);
  if (!ctx) {
    // A missing provider means a surface rendered outside the app shell. Rather
    // than throw during render, report the shipped state: nothing to play.
    return {
      tracks: [],
      loading: false,
      current: null,
      playing: false,
      blocked: false,
      mutedByUser: false,
      language: 'ta',
      available: false,
      availableLanguages: [],
      emptyReason: 'no-catalogue',
      play: () => {},
      playTrack: () => {},
      pause: () => {},
      toggle: () => {},
      next: () => {},
      setLanguage: () => {},
      setMutedByUser: () => {},
    };
  }
  return ctx;
}

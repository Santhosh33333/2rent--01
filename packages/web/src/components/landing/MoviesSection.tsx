import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Film, Ticket, ExternalLink, CalendarPlus } from 'lucide-react';
import { api } from '../../lib/api';

/**
 * "Now playing / upcoming" strip on the landing page.
 *
 * Scope, stated plainly because it is easy to over-promise here: TMDB tells us
 * which INDIAN-origin films are in theatrical release and which are releasing
 * soon, with posters. It does NOT know which cinema is showing them in Chennai,
 * at what time, or for how much - no free API does. So each card links out to
 * BookMyShow for the actual booking and says so, rather than implying we have
 * showtimes. The theatre, showtime and price on a movie EVENT are entered by
 * the organiser, never inferred for them.
 *
 * `nowPlaying` and `upcoming` come already separated by the backend (release
 * date vs the server clock). We render what we are given and never merge or
 * splice in anything local, so the strip cannot drift from what TMDB said.
 *
 * Every outbound link is `rel="noopener noreferrer"`: it leaves the site, and
 * `noopener` stops the opened tab reaching back through `window.opener`.
 */

interface LandingMovie {
  id: number;
  title: string;
  posterUrl: string | null;
  releaseDate: string | null;
  originalLanguage: string | null;
  overview: string | null;
  bookingUrl: string;
}

interface Feed {
  nowPlaying: LandingMovie[];
  upcoming: LandingMovie[];
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; feed: Feed; configured: boolean }
  | { status: 'error' };

function formatRelease(value: string | null): string {
  if (!value) return '';
  const parsed = new Date(`${value}T00:00:00`);
  if (isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A quick language label for a TMDB code, for people scanning for "Tamil". */
function languageLabel(code: string | null): string | null {
  switch (code) {
    case 'ta': return 'Tamil';
    case 'hi': return 'Hindi';
    case 'te': return 'Telugu';
    case 'ml': return 'Malayalam';
    case 'kn': return 'Kannada';
    case 'bn': return 'Bengali';
    case 'mr': return 'Marathi';
    case 'gu': return 'Gujarati';
    case 'pa': return 'Punjabi';
    case 'ur': return 'Urdu';
    default: return code ? code.toUpperCase() : null;
  }
}

function MovieCard({ movie, upcoming }: { movie: LandingMovie; upcoming: boolean }) {
  const lang = languageLabel(movie.originalLanguage);
  return (
    <article
      className="glass-card"
      style={{ overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '2 / 3',
          background: 'linear-gradient(160deg, rgba(0,0,0,.28), rgba(0,0,0,.06))',
        }}
      >
        {movie.posterUrl ? (
          <img
            src={movie.posterUrl}
            alt={`${movie.title} poster`}
            loading="lazy"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.5,
            }}
          >
            <Film size={32} aria-hidden="true" />
          </div>
        )}
        <span
          className={`nb-pill ${upcoming ? 'nb-pill--free' : 'nb-pill--live'}`}
          style={{ position: 'absolute', top: 10, left: 10, backdropFilter: 'blur(4px)' }}
        >
          {upcoming ? 'Upcoming' : 'Now playing'}
        </span>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <h3
          style={{
            margin: 0,
            fontSize: '1rem',
            lineHeight: 1.3,
            fontWeight: 700,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {movie.title}
        </h3>

        <p
          style={{
            margin: 0,
            fontSize: '0.8125rem',
            opacity: 0.75,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {upcoming
            ? `Releases ${formatRelease(movie.releaseDate) || 'soon'}${lang ? ` · ${lang}` : ''}`
            : movie.overview || `In cinemas now${lang ? ` · ${lang}` : ''}.`}
        </p>

        <div style={{ display: 'flex', gap: 8, marginTop: 'auto', flexWrap: 'wrap' }}>
          {!upcoming && (
            <a
              className="nb-btn nb-btn--primary"
              href={movie.bookingUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: '0.8125rem' }}
            >
              <Ticket size={14} aria-hidden="true" />
              Showtimes
            </a>
          )}
          <Link
            className="nb-btn nb-btn--secondary"
            to={`/events?category=movies`}
            style={{ fontSize: '0.8125rem' }}
          >
            <CalendarPlus size={14} aria-hidden="true" />
            {upcoming ? 'Post opening-day event' : 'Post an event'}
          </Link>
        </div>
      </div>
    </article>
  );
}

function Grid({ movies, upcoming }: { movies: LandingMovie[]; upcoming: boolean }) {
  if (movies.length === 0) return null;
  return (
    <div className="nb-grid nb-grid--3">
      {movies.map((movie) => (
        <MovieCard key={`${upcoming ? 'up' : 'now'}-${movie.id}`} movie={movie} upcoming={upcoming} />
      ))}
    </div>
  );
}

export function MoviesSection() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    // Public page: never let a slow third-party call hold the section open.
    const timer = window.setTimeout(() => controller.abort(), 7000);

    api
      .get('/public/movies/now-playing', { signal: controller.signal, timeout: 6000 })
      .then((res) => {
        const payload = res.data?.data;
        const feed: Feed = {
          nowPlaying: Array.isArray(payload?.nowPlaying) ? payload.nowPlaying : [],
          upcoming: Array.isArray(payload?.upcoming) ? payload.upcoming : [],
        };
        setState({ status: 'ready', feed, configured: payload?.configured !== false });
      })
      .catch((err) => {
        if (err?.code !== 'ERR_CANCELED') setState({ status: 'error' });
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const feed = state.status === 'ready' ? state.feed : null;
  const empty =
    state.status === 'ready' && feed!.nowPlaying.length === 0 && feed!.upcoming.length === 0;
  // Hide the whole section when there is nothing to show. An empty "coming
  // soon" grid is worse than no section, and this keeps the landing page honest
  // about whether the feature is live.
  if (empty || state.status === 'error') return null;

  return (
    <section className="nb-section" aria-labelledby="nb-movies-heading">
      <div className="nb-container">
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 16,
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginBottom: 28,
          }}
        >
          <div style={{ flex: '1 1 320px' }}>
            <p className="nb-eyebrow" style={{ margin: '0 0 12px' }}>
              Movies
            </p>
            <h2 id="nb-movies-heading" className="nb-display nb-h2" style={{ margin: 0 }}>
              Real listings, meetups and movie partners.
            </h2>
            <p
              style={{
                margin: '14px 0 0',
                maxWidth: '56ch',
                opacity: 0.78,
              }}
            >
              Indian films now in cinemas and releasing soon - live titles, no placeholder data.
              Pick a film, set the showtime and price, and meet up with your crew.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="nb-btn nb-btn--secondary" to="/events?category=movies">
              Browse movie events
            </Link>
            <Link className="nb-btn nb-btn--primary" to="/events?category=movies">
              Post a movie event
            </Link>
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="nb-grid nb-grid--3" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="nb-skeleton" style={{ height: 260 }} />
            ))}
          </div>
        )}

        {feed && (
          <>
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>
                In cinemas now
              </h3>
              <Grid movies={feed.nowPlaying} upcoming={false} />
            </div>

            <div>
              <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700 }}>
                Opening soon
              </h3>
              <Grid movies={feed.upcoming} upcoming={true} />
            </div>
          </>
        )}

        {feed && (feed.nowPlaying.length > 0 || feed.upcoming.length > 0) && (
          <p
            style={{
              margin: '20px 0 0',
              fontSize: '0.75rem',
              opacity: 0.6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <ExternalLink size={12} aria-hidden="true" />
            Films from TMDB. Showtimes and tickets are BookMyShow&apos;s - we link out rather
            than guess them.
          </p>
        )}
      </div>
    </section>
  );
}
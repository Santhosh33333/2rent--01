/**
 * The four pillars: dating, events, community, movies.
 *
 * Each is the same shape - copy on one side, a mock stage on the other - but
 * the stages carry very different amounts of real content, and the honest
 * thing is to let that show.
 *
 * **Events and movies** have anonymous-readable endpoints, so their stages are
 * live: real event rows, real TMDB posters.
 *
 * **Dating and community** sit behind `authenticateToken` (dating also needs
 * KYC and a paid window). A signed-out visitor gets the section's copy, its CTA
 * and an explanation - not a carousel of invented people. The reference design
 * had "Karthik, 27 · Coffee · Cricket · Films" and "It's a Match! You and Divya
 * liked each other" hard-coded into the markup, which is precisely the thing
 * this page must never do.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Film, Heart, Users } from 'lucide-react';
import { Backdrop } from '../components/Backdrop';
import { StateBlock } from '../components/StateBlock';
import {
  formatEventDate,
  formatPrice,
  formatReleaseDate,
  imageUrl,
  initialsOf,
  type Community,
  type DiscoverProfile,
  type EventCategory,
  type GatedResource,
  type MovieSummary,
  type PublicEvent,
  type Resource,
} from '../hooks/useLandingContent';

interface PillarProps {
  id: string;
  kind: 'dating' | 'events' | 'community' | 'movies';
  icon: ReactNode;
  title: string;
  sub: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  ctaTone?: 'pink' | 'purple' | 'teal';
  caption: { label: string; detail: string };
  /**
   * Decorative script text, one array entry per line. Hidden from assistive
   * tech - it is pure flourish and repeating it to a screen reader would just
   * be noise between the heading and the copy.
   */
  hand?: string[];
  children: ReactNode;
}

const TONE_CLASS = {
  pink: 'nb-btn',
  purple: 'nb-btn nb-btn--purple',
  teal: 'nb-btn nb-btn--teal',
} as const;

/**
 * Internal routes go through `<Link>` so the SPA router handles them and the
 * already-loaded bundle is not thrown away. A plain anchor would remount the
 * whole tree and re-run every request this page just made.
 */
export function RouteLink({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  if (to.startsWith('/')) {
    return (
      <Link className={className} to={to}>
        {children}
      </Link>
    );
  }
  return (
    <a className={className} href={to}>
      {children}
    </a>
  );
}

export function Pillar({
  id,
  kind,
  icon,
  title,
  sub,
  body,
  ctaLabel,
  ctaHref,
  ctaTone = 'pink',
  caption,
  hand,
  children,
}: PillarProps) {
  return (
    <section
      className={`nb-section nb-pillar nb-pillar--${kind}`}
      id={id}
      aria-labelledby={`${id}-h`}
    >
      <Backdrop scene={kind} name={kind} />
      <div className="nb-veil nb-veil--pillar" />

      <div className="nb-wrap nb-pillar-grid">
        <div className="nb-cap nb-rv">
          <span className="nb-cap-icon">{icon}</span>
          <span>
            <strong>{caption.label}</strong>
            <small>{caption.detail}</small>
          </span>
        </div>

        <div className="nb-pillar-info nb-rv">
          <h2 id={`${id}-h`}>
            {icon}
            {title}
          </h2>
          <h3>{sub}</h3>
          <p className="nb-body">{body}</p>
          <RouteLink className={TONE_CLASS[ctaTone]} to={ctaHref}>
            {ctaLabel} <span aria-hidden="true">&rarr;</span>
          </RouteLink>
        </div>

        <div className="nb-pillar-stage nb-rv">{children}</div>
      </div>

      {hand ? (
        <p className="nb-hand nb-script" aria-hidden="true">
          {hand.map((line) => (
            <span key={line} style={{ display: 'block' }}>
              {line}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Dating                                                              */
/* ------------------------------------------------------------------ */

interface DatingProps {
  profiles: GatedResource<{ results?: DiscoverProfile[]; items?: DiscoverProfile[] }>;
  signedIn: boolean;
}

export function DatingSection({ profiles, signedIn }: DatingProps) {
  const people = profiles.data?.results ?? profiles.data?.items ?? [];

  return (
    <Pillar
      id="dating"
      kind="dating"
      icon={<Heart aria-hidden="true" />}
      title="Dating"
      sub="Meet people who are actually nearby"
      body="Swipe through people around you, match, and chat. Every profile is tied to a verified account, and precise locations are never published - you see the distance band, not an address."
      ctaLabel={signedIn ? 'Start swiping' : 'Sign in to start'}
      ctaHref={signedIn ? '/dating' : '/login'}
      caption={{ label: 'Dating', detail: 'Verified people, nearby' }}
      hand={['Real connections', 'start here']}
    >
      <div className="nb-stage nb-stage--sm">
        {profiles.loading || profiles.gated || profiles.error || people.length === 0 ? (
          <StateBlock
            resource={profiles}
            gated={profiles.gated}
            subject="profiles"
            gatedBody="Dating opens once you are signed in and verified, so the people you see are people who exist."
            emptyBody="No one is discoverable near you yet. Try again once more people join."
          />
        ) : (
          <div className="nb-duo">
            {people.slice(0, 2).map((person, index) => (
              <div
                key={person.id}
                className={`nb-duo-card ${index === 0 ? 'nb-duo-front' : 'nb-duo-back'}`}
              >
                <div className="nb-screen" style={{ padding: 0 }}>
                  {imageUrl(person.avatarUrl) ? (
                    <img
                      src={imageUrl(person.avatarUrl) ?? ''}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : null}
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(180deg,transparent 45%,rgba(7,4,15,0.92))',
                    }}
                  />
                  <div style={{ position: 'relative', marginTop: 'auto', padding: 16, textAlign: 'center' }}>
                    <b style={{ fontSize: 17 }}>
                      {person.fullName}
                      {person.age ? `, ${person.age}` : ''}
                    </b>
                    <small style={{ display: 'block', color: 'rgba(255,255,255,0.72)' }}>
                      {[person.city, person.distance].filter(Boolean).join(' · ') || 'Nearby'}
                    </small>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Pillar>
  );
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

interface EventsProps {
  events: Resource<{ items: PublicEvent[] }>;
  categories: Resource<{ categories: EventCategory[] }>;
}

export function EventsSection({ events, categories }: EventsProps) {
  const items = events.data?.items ?? [];
  const cats = (categories.data?.categories ?? []).filter(
    (category) => category.enabled && !category.isPseudo,
  );

  return (
    <Pillar
      id="events"
      kind="events"
      icon={<CalendarDays aria-hidden="true" />}
      title="Events"
      sub="Be part of something"
      body="Concerts, meetups, workshops, festivals. Browse what is happening near you, see who is going, and start your own in a couple of taps."
      ctaLabel="Explore events"
      ctaHref="/events"
      ctaTone="purple"
      caption={{ label: 'Events', detail: 'Live from the public feed' }}
      hand={['Good vibes', 'only']}
    >
      <div className="nb-stage nb-stage--sm">
        {events.loading || events.error || items.length === 0 ? (
          <StateBlock
            resource={events}
            subject="events"
            emptyBody="No events are published right now. Anyone can start the first one."
          />
        ) : (
          <div className="nb-evwrap">
            {items.slice(0, 3).map((event, index) => (
              <article
                key={event.id}
                className={`nb-ev nb-ev--${index === 0 ? 'main' : index === 1 ? 'left' : 'right'}`}
              >
                <h5>{event.title}</h5>
                <span>{event.location ?? (event.isOnline ? 'Online' : 'Location shared on join')}</span>
                <span>{formatEventDate(event.startTime, event.timezone)}</span>
                <span>
                  {[formatPrice(event.price, event.currency), event.isFull
                    ? 'Full'
                    : event.seatsLeft !== null
                      ? `${event.seatsLeft} left`
                      : event.attendeeCount > 0
                        ? `${event.attendeeCount} going`
                        : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </article>
            ))}
          </div>
        )}

        {/* The server's own taxonomy, read live. Not a hand-written chip row -
            the reference listed "Travel Buddies / Food Lovers / Tech & Career /
            Music / Fitness", which do not correspond to anything in the
            database. */}
        {cats.length > 0 ? (
          <div className="nb-chips" style={{ maxWidth: 460, margin: '12px auto 0' }}>
            {cats.slice(0, 6).map((category) => (
              <Link key={category.key} className="nb-chip" to={`/events?category=${category.key}`}>
                {category.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Pillar>
  );
}

/* ------------------------------------------------------------------ */
/* Community                                                           */
/* ------------------------------------------------------------------ */

interface CommunityProps {
  communities: GatedResource<{
    items: Community[];
    total: number;
  }>;
}

export function CommunitySection({ communities }: CommunityProps) {
  const groups = communities.data?.items ?? [];
  const total = communities.data?.total ?? 0;

  return (
    <Pillar
      id="community"
      kind="community"
      icon={<Users aria-hidden="true" />}
      title="Community"
      sub="Share. Support. Grow."
      body="Join groups around the things you actually care about, post, and keep the conversation going. Members decide who can join."
      ctaLabel="Join a community"
      ctaHref="/communities"
      ctaTone="teal"
      caption={{ label: 'Community', detail: 'Groups you can actually join' }}
      hand={['Better together']}
    >
      <div className="nb-stage nb-stage--sm">
        {communities.loading || communities.gated || communities.error || groups.length === 0 ? (
          <StateBlock
            resource={communities}
            gated={communities.gated}
            subject="communities"
            gatedBody="Community membership is tied to your account, so only signed-in members can browse and join."
            emptyBody="No groups have been created yet. Start the first one."
          />
        ) : (
          <>
            <div className="nb-msgs">
              {groups.slice(0, 3).map((group) => (
                <div key={group.id} className="nb-msg">
                  <span className="nb-mini-av">
                    {imageUrl(group.avatarUrl) ? (
                      <img src={imageUrl(group.avatarUrl) ?? ''} alt="" loading="lazy" />
                    ) : (
                      initialsOf(group.name) || '·'
                    )}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong>
                      {group.name}
                      {group.city ? ` · ${group.city}` : ''}
                    </strong>
                    <div>{group.description ?? 'No description yet.'}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="nb-chips" style={{ justifyContent: 'center' }}>
              <span className="nb-chip">
                {total} group{total === 1 ? '' : 's'} on the server
              </span>
              {groups.slice(0, 4).map((group) => (
                <Link key={group.id} className="nb-chip" to={`/communities/${group.id}`}>
                  {group.name} · {group.memberCount}
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </Pillar>
  );
}

/* ------------------------------------------------------------------ */
/* Movies                                                              */
/* ------------------------------------------------------------------ */

interface MoviesProps {
  movies: Resource<{
    configured: boolean;
    nowPlaying: MovieSummary[];
    comingSoon: MovieSummary[];
    /**
     * Further out than the coming-soon window. It has always been on the wire and
     * was never rendered, which is why "Jailer 2" - the title most people on this
     * audience were actually asking about - was reachable only by digging through
     * the /movies page.
     */
    upcoming: MovieSummary[];
    /** True when the provider failed and this is the last good feed. */
    stale?: boolean;
  }>;
}

function Poster({ movie, slot }: { movie: MovieSummary; slot: 1 | 2 | 3 }) {
  const poster = imageUrl(movie.posterUrl);
  const released = formatReleaseDate(movie.releaseDate);

  // Where "book tickets" goes is decided on the server, and it is a real ticket
  // partner page rather than an in-app checkout we do not have. Rendered as a
  // plain outbound link with the destination shown, rather than dressed up as a
  // button that leads nowhere.
  //
  // The fallback used to be "#download", a section anchor that is not even a
  // route - so a film with no booking link looked clickable and did nothing.
  // /movies is a real route and always resolves.
  const href = movie.bookingUrl || '/movies';
  const outbound = movie.bookingUrl.startsWith('http');

  return (
    <a
      className={`nb-poster nb-poster--${slot}`}
      href={href}
      target={outbound ? '_blank' : undefined}
      rel={outbound ? 'noopener noreferrer' : undefined}
    >
      {poster ? <img src={poster} alt="" loading="lazy" decoding="async" /> : null}
      <b>{movie.title}</b>
      <span>{released || (movie.originalLanguage ?? 'In cinemas')}</span>
    </a>
  );
}

/**
 * A film further out than the coming-soon window.
 *
 * Same outbound-link rule as {@link Poster}: the booking destination comes from
 * the server, is a real ticket partner page, and opens in a new tab with
 * `rel="noopener noreferrer"`. `/movies` is the fallback when a row somehow has no
 * booking link, because it is a real route - a `#` anchor would not be.
 */
function UpcomingRow({ movie }: { movie: MovieSummary }) {
  const poster = imageUrl(movie.posterUrl);
  const href = movie.bookingUrl || '/movies';
  const outbound = movie.bookingUrl.startsWith('http');

  return (
    <a
      className="nb-soon-item"
      href={href}
      target={outbound ? '_blank' : undefined}
      rel={outbound ? 'noopener noreferrer' : undefined}
    >
      {poster ? (
        <img src={poster} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="nb-soon-blank" aria-hidden="true" />
      )}
      <span style={{ minWidth: 0 }}>
        <b>{movie.title}</b>
        {/* The real release date, never a relative guess like "next month". */}
        <small>{formatReleaseDate(movie.releaseDate) || 'Date to be confirmed'}</small>
      </span>
    </a>
  );
}

export function MoviesSection({ movies }: MoviesProps) {
  const payload = movies.data;
  const films = [...(payload?.nowPlaying ?? []), ...(payload?.comingSoon ?? [])].slice(0, 3);
  // Only titles that are not already on a poster, so a film cannot appear twice
  // in the same section on the day its date is corrected.
  const posterIds = new Set(films.map((m) => m.id));
  const onTheWay = (payload?.upcoming ?? [])
    .filter((m) => !posterIds.has(m.id))
    .slice(0, 4);

  return (
    <Pillar
      id="movies"
      kind="movies"
      icon={<Film aria-hidden="true" />}
      title="Movies"
      sub="Lights. Camera. Company."
      body="What is in cinemas right now, refreshed every morning, and what opens next. Tap a film to get tickets from our ticketing partner, and save the ones you want to see. Movie nights you organise show up in Events too, so nobody has to be in two places."
      ctaLabel="Browse movies"
      ctaHref="/movies"
      ctaTone="purple"
      caption={{ label: 'Movies', detail: 'Now playing, from TMDB' }}
      hand={['Movie nights,', 'better together']}
    >
      <div className="nb-stage nb-stage--sm">
        {movies.loading || movies.error || films.length === 0 ? (
          <StateBlock
            resource={movies}
            subject="films"
            emptyBody={
              payload && !payload.configured
                ? 'The film feed is not connected yet. Set TMDB_API_KEY on the server to switch it on.'
                : 'No films are listed right now.'
            }
          />
        ) : (
          <div className="nb-movies">
            <div className="nb-posters">
              {films.map((movie, index) => (
                <Poster key={movie.id} movie={movie} slot={(index % 3) + 1 as 1 | 2 | 3} />
              ))}
              {payload?.stale ? (
                <p className="nb-state-body" style={{ position: 'absolute', bottom: -8, left: 0 }}>
                  Showing the last good feed &mdash; the film provider is unreachable right now.
                </p>
              ) : null}
            </div>

            {/* The far shelf, which used to be fetched daily and never shown. */}
            {onTheWay.length > 0 ? (
              <div className="nb-soon">
                <p className="nb-soon-head">On the way</p>
                <ul className="nb-soon-list">
                  {onTheWay.map((movie) => (
                    <li key={movie.id}>
                      <UpcomingRow movie={movie} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Pillar>
  );
}



/**
 * Landing hero — new build.
 *
 * Same contract as the hero it replaces: the card cluster shows REAL events
 * from `/api/public/events` and collapses to nothing when the backend has none.
 * Inventing listings here would make a floating card indistinguishable from a
 * real one, which is the exact failure the previous version was written to
 * avoid, so that rule is kept intact.
 *
 * What is new is the motion: the headline arrives word by word in 3D, the
 * rotating line flips rather than cross-fades, the CTAs press in 3D, and the
 * event cards tip toward the pointer. All of it is transform/opacity only and
 * all of it is disabled under prefers-reduced-motion.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Compass, MapPin, Radio, Sparkles } from 'lucide-react';
import { NabriMark } from './NabriLogo';
import { HeroMotion } from './HeroMotion';
import { CountUp, useTilt3D } from './motion3d';
import { api } from '../../lib/api';
import { readEventItems, type LandingEvent } from './types';

/** Rotating line. Each entry is a plain string so nothing is announced on swap. */
const ROTATING = [
  'Meet people who match your vibe.',
  'Find your next activity.',
  'Discover your people.',
  'Life is better together.',
];

const CATEGORY_ACCENT: Record<string, string> = {
  SPORTS: '#2B4FD8',
  FITNESS: '#2B4FD8',
  WALKING: '#22B8CF',
  DATING: '#7C5CF0',
  SOCIAL: '#EC6A9C',
  COMMUNITY: '#A78BFA',
  MOVIE: '#7C5CF0',
  FOOD: '#EC6A9C',
  TRAVEL: '#2B4FD8',
  MUSIC: '#A78BFA',
};
const FALLBACK_ACCENT = '#2B4FD8';

function accentFor(event: LandingEvent): string {
  return CATEGORY_ACCENT[(event.category ?? '').toUpperCase()] ?? FALLBACK_ACCENT;
}

/** Short meta line under the title: live now, or the day it starts. */
function metaFor(event: LandingEvent): string {
  if (event.isLive) return 'Live now';
  const when = new Date(event.startTime);
  if (isNaN(when.getTime())) return event.category ?? 'Event';
  const today = new Date();
  return when.toDateString() === today.toDateString()
    ? `Today, ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/**
 * One real event, as a card that tips toward the pointer in 3D.
 *
 * Split out so each card gets its own tilt listener. One shared listener on the
 * cluster would be cheaper but cannot work out which card the pointer is over,
 * and per-card rect measurement is the part that has to be right.
 */
function EventCard({
  event,
  index,
  style,
}: {
  event: LandingEvent;
  index: number;
  style: CSSProperties;
}) {
  const ref = useTilt3D<HTMLAnchorElement>(11);

  return (
    <Link
      ref={ref}
      to={`/events/${event.id}`}
      className="nb-tilt-card nb-event-card"
      style={{ ...style, animation: `nbFloat 7s ${(index % 4) * 0.9}s ease-in-out infinite` }}
    >
      <span className="nb-event-card__row">
        <span className="nb-event-card__swatch" style={{ background: accentFor(event) }} />
        <span className="nb-event-card__title">{event.title}</span>
      </span>
      <span className="nb-event-card__meta">
        {event.isLive && <Radio size={11} aria-hidden="true" className="nb-event-card__live" />}
        {metaFor(event)}
      </span>
    </Link>
  );
}

export function NewHero() {
  const [lineIndex, setLineIndex] = useState(0);
  const [events, setEvents] = useState<LandingEvent[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(
      () => setLineIndex((current) => (current + 1) % ROTATING.length),
      4200,
    );
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // Bounded like the original: a stalled backend must not leave the hero
    // waiting on it.
    const timer = window.setTimeout(() => controller.abort(), 6000);

    api
      .get('/public/events', { params: { limit: 6 }, signal: controller.signal, timeout: 5000 })
      .then((res) => setEvents(readEventItems(res.data)))
      .catch(() => setEvents([]))
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  return (
    <section className="nb-hero nb-hero--v2">
      <HeroMotion />

      <div className="nb-container nb-hero__grid">
        <div className="nb-hero__copy">
          <p className="nb-eyebrow nb-hero__eyebrow">
            <span className="nb-hero__pulse" aria-hidden="true" />
            A social lifestyle platform
          </p>

          {/* Words are separate elements purely so the entrance can stagger
              them. The h1 still reads as one sentence to a screen reader. */}
          <h1 className="nb-display nb-h1 nb-hero__title">
            <span className="nb-hero__word" style={{ animationDelay: '40ms' }}>
              Your
            </span>{' '}
            <span className="nb-hero__word nb-hero__word--accent" style={{ animationDelay: '110ms' }}>
              Partner
            </span>{' '}
            <span className="nb-hero__word" style={{ animationDelay: '180ms' }}>
              for
            </span>{' '}
            <span className="nb-hero__word" style={{ animationDelay: '250ms' }}>
              Every
            </span>{' '}
            <span className="nb-hero__word" style={{ animationDelay: '320ms' }}>
              Side
            </span>{' '}
            <span className="nb-hero__word" style={{ animationDelay: '390ms' }}>
              of
            </span>{' '}
            <span className="nb-hero__word" style={{ animationDelay: '460ms' }}>
              Life.
            </span>
          </h1>

          {/* Deliberately not aria-live: a polite region re-announces on every
              change, interrupting the user every four seconds, forever. */}
          <p className="nb-hero__rotator">
            <span key={lineIndex} className="nb-hero__rotator-line">
              {ROTATING[lineIndex]}
            </span>
          </p>

          <p className="nb-lead nb-hero__lead">
            Friendship, dating, activities, events, communities and more — all in one place.
          </p>

          <div className="nb-hero__actions">
            <Link className="nb-btn nb-btn--primary nb-btn--lg nb-press" to="/download">
              <NabriMark size={20} title="" />
              Get the Nabri App
            </Link>
            <Link className="nb-btn nb-btn--secondary nb-btn--lg nb-press" to="/register">
              Create Account
            </Link>
            <Link className="nb-btn nb-btn--ghost nb-btn--lg nb-press" to="/discover">
              <Compass size={18} aria-hidden="true" />
              Explore Nabri
            </Link>
          </div>

          <p className="nb-hero__note">
            <MapPin size={15} aria-hidden="true" />
            Built around people near you
          </p>

          {/* Real number, real source. Omitted entirely when the backend has no
              events, rather than showing a zero that implies a broken search. */}
          {events.length > 0 && (
            <p className="nb-hero__count">
              <Sparkles size={14} aria-hidden="true" />
              <CountUp value={events.length} /> live listings on the board right now
            </p>
          )}
        </div>

        {events.length > 0 && (
          <div className="nb-hero__cluster nb-3d-scene">
            {events.map((event, index) => (
              <EventCard
                key={event.id}
                event={event}
                index={index}
                style={{ left: `${18 + (index % 2) * 36}%`, top: `${12 + (index % 2) * 32}%` }}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        @media (min-width: 900px) {
          .nb-hero__cluster { display: block; }
        }
        @media (max-width: 899px) {
          .nb-hero__grid { grid-template-columns: minmax(0, 1fr); }
          .nb-hero__cluster { display: none; }
        }
      `}</style>
    </section>
  );
}
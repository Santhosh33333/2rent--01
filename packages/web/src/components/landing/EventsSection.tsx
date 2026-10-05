/**
 * Marketing Events section.
 *
 * Shows real events only, fetched from `/api/public/events` - a public,
 * field-whitelisted, read-only endpoint added specifically for this page.
 * Before that existed, this section called `/api/events`, which sits behind
 * `authenticateToken` + `requireKycVerified`, so every anonymous visitor got an
 * auth wall on the one section meant to prove the product is alive.
 *
 * The public feed never returns PRIVATE events, exact coordinates, the online
 * meeting URL, or any organizer role, so a stranger sees the poster and nothing
 * more. Joining still goes through the authenticated register route.
 *
 * Live state uses the server's own `isLive`, which is computed as
 * startTime <= serverNow < endTime. The client never recomputes it, so a
 * skewed device clock cannot make a finished event look live.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, MapPin, Users, Radio, ArrowRight, Globe } from 'lucide-react';
import { api } from '../../lib/api';

import type { LandingEvent } from './types';
import { readEventItems } from './types';

type State =
  | { status: 'loading' }
  | { status: 'ready'; events: LandingEvent[] }
  // Degraded state: the deployed backend has no public route yet. Kept so an
  // older server produces a clear sign-in prompt instead of a broken section.
  | { status: 'unavailable' }
  | { status: 'error' };

function formatWhen(value: string): string {
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EventCard({ event }: { event: LandingEvent }) {
  const free = event.price === null || event.price === undefined || Number(event.price) === 0;
  const seats =
    event.capacity && event.attendeeCount
      ? `${event.attendeeCount}/${event.capacity}`
      : event.attendeeCount
      ? String(event.attendeeCount)
      : null;

  return (
    <Link
      to={`/events/${event.id}`}
      className="nb-card nb-card--hover nb-card--pad"
      style={{ display: 'flex', flexDirection: 'column', gap: 10, textDecoration: 'none' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {event.isLive === true && (
          <span className="nb-pill nb-pill--live">
            <Radio size={12} aria-hidden="true" />
            LIVE
          </span>
        )}
        {event.category && <span className="nb-pill">{event.category}</span>}
        <span className={`nb-pill ${free ? 'nb-pill--free' : 'nb-pill--paid'}`}>
          {free ? 'Free' : `₹${Number(event.price).toFixed(0)}`}
        </span>
      </div>

      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, letterSpacing: '-0.015em', color: 'var(--nb-ink)' }}>
        {event.title}
      </h3>

      <div style={{ display: 'grid', gap: 6, fontSize: 13.5, color: 'var(--nb-ink-soft)' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <CalendarDays size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
          {formatWhen(event.startTime)}
        </span>
        {event.isOnline ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Globe size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
            Online event
          </span>
        ) : event.location ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <MapPin size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
            {event.location}
          </span>
        ) : null}
        {seats && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Users size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
            {seats} going
          </span>
        )}
      </div>

      <span
        style={{
          marginTop: 2,
          fontSize: 14,
          fontWeight: 650,
          color: 'var(--nb-blue)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {event.isLive ? 'Join live' : 'View event'}
        <ArrowRight size={14} aria-hidden="true" />
      </span>
    </Link>
  );
}

export function EventsSection() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    // Public page: do not hold the connection open, and never let a slow
    // backend stall the section.
    const timer = window.setTimeout(() => controller.abort(), 6000);

    api
      .get('/public/events', {
        params: { limit: 12 },
        signal: controller.signal,
        timeout: 5000,
      })
      .then((res) => {
        setState({ status: 'ready', events: readEventItems(res.data) });
      })
      .catch((err) => {
        // A 401 here means the deployment is still running a backend without the
        // public route, so degrade to the sign-in prompt rather than an
        // unexplained failure.
        const status = err?.response?.status;
        if (status === 401 || status === 403) {
          setState({ status: 'unavailable' });
        } else if (err?.code !== 'ERR_CANCELED') {
          setState({ status: 'error' });
        }
      })
      .finally(() => window.clearTimeout(timer));

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  const live = state.status === 'ready' ? state.events.filter((event) => event.isLive === true) : [];
  const shown = state.status === 'ready' ? state.events : [];

  return (
    <section className="nb-section" aria-labelledby="nb-events-heading">
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
              Events
            </p>
            <h2 id="nb-events-heading" className="nb-display nb-h2" style={{ margin: 0 }}>
              Something is always happening.
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link className="nb-btn nb-btn--secondary" to="/events">
              Browse all
            </Link>
            <Link className="nb-btn nb-btn--primary" to="/events">
              Create an Event
            </Link>
          </div>
        </div>

        {state.status === 'loading' && (
          <div className="nb-grid nb-grid--3" aria-hidden="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="nb-skeleton" style={{ height: 210 }} />
            ))}
          </div>
        )}

        {state.status === 'unavailable' && (
          <div className="nb-empty">
            <div className="nb-empty__title">Browsing events needs a Nabri account</div>
            <p style={{ margin: '0 auto 18px', maxWidth: '52ch' }}>
              Event listings are currently served only to signed-in, verified members so
              that attendee and organiser details stay private. This is a real limit of
              the product, not a placeholder.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <Link className="nb-btn nb-btn--primary" to="/register">
                Create a free account
              </Link>
              <Link className="nb-btn nb-btn--secondary" to="/login">
                Log in
              </Link>
            </div>
          </div>
        )}

        {state.status === 'error' && (
          <div className="nb-empty">
            <div className="nb-empty__title">Events could not be loaded right now</div>
            <p style={{ margin: 0 }}>Please try again shortly.</p>
          </div>
        )}

        {state.status === 'ready' && shown.length === 0 && (
          <div className="nb-empty">
            <div className="nb-empty__title">No events available yet.</div>
            <p style={{ margin: '0 auto 18px', maxWidth: '48ch' }}>
              Nothing is scheduled at the moment. Be the first to put something on.
            </p>
            <Link className="nb-btn nb-btn--primary" to="/events">
              Create an Event
            </Link>
          </div>
        )}

        {live.length > 0 && (
          <div style={{ marginBottom: 32 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={17} aria-hidden="true" style={{ color: '#EC6A9C' }} />
              Live Now
            </h3>
            <div className="nb-grid nb-grid--3">
              {live.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        )}

        {shown.length > 0 && (
          <div className="nb-grid nb-grid--3">
            {shown
              .filter((event) => event.isLive !== true)
              .slice(0, 6)
              .map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
          </div>
        )}
      </div>
    </section>
  );
}

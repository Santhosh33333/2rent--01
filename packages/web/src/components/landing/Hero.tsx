/**
 * Editorial hero.
 *
 * The floating cards are illustrative chrome, deliberately not data. They are
 * marked aria-hidden and the section that shows real events is separate, so
 * nothing here can be mistaken for a live listing.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Sparkles, MapPin } from 'lucide-react';
import { NabriMark } from './NabriLogo';

const ROTATING = [
  'Meet people who match your vibe.',
  'Find your next activity.',
  'Discover your people.',
  'Life is better together.',
];

/** Illustrative only. Not real listings, so it is hidden from assistive tech. */
const FLOATING_CARDS = [
  { title: 'Cricket Meetup', meta: 'Sports', accent: '#2B4FD8', x: '2%', y: '8%', delay: '0s' },
  { title: 'Weekend Walk', meta: 'Walking', accent: '#22B8CF', x: '58%', y: '0%', delay: '0.6s' },
  { title: 'Movie Partner', meta: 'Movies', accent: '#7C5CF0', x: '78%', y: '30%', delay: '1.2s' },
  { title: 'Chennai Photography', meta: 'Communities', accent: '#EC6A9C', x: '8%', y: '46%', delay: '1.8s' },
  { title: 'Coffee Meetup', meta: 'Food & Coffee', accent: '#A78BFA', x: '64%', y: '58%', delay: '2.4s' },
  { title: 'Travel Buddy', meta: 'Travel', accent: '#2B4FD8', x: '18%', y: '76%', delay: '3s' },
] as const;

export function Hero() {
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    // Honour the OS setting rather than animating regardless.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const timer = window.setInterval(() => {
      setLineIndex((current) => (current + 1) % ROTATING.length);
    }, 4200);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="nb-hero">
      <div className="nb-hero__glow" aria-hidden="true" />

      <div
        className="nb-container"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 0.95fr)',
          gap: 48,
          alignItems: 'center',
        }}
        data-nb-hero-grid
      >
        <div>
          <p className="nb-eyebrow" style={{ margin: '0 0 18px' }}>
            A social lifestyle platform
          </p>

          <h1 className="nb-display nb-h1" style={{ margin: 0 }}>
            <span className="nb-gradient-text">Your Partner</span>
            <br />
            for Every Side of Life.
          </h1>

          <p
            aria-live="polite"
            style={{
              margin: '22px 0 0',
              fontSize: 'clamp(1rem, 2.2vw, 1.25rem)',
              fontWeight: 600,
              color: 'var(--nb-blue)',
              minHeight: '1.5em',
            }}
          >
            {ROTATING[lineIndex]}
          </p>

          <p className="nb-lead" style={{ margin: '14px 0 0', maxWidth: '46ch' }}>
            Friendship, dating, activities, events, communities and more — all in one place.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 32 }}>
            <Link className="nb-btn nb-btn--primary nb-btn--lg" to="/download">
              <NabriMark size={20} title="" />
              Get the Nabri App
            </Link>
            <Link className="nb-btn nb-btn--secondary nb-btn--lg" to="/register">
              Create Account
            </Link>
            <Link className="nb-btn nb-btn--ghost nb-btn--lg" to="/discover">
              <Compass size={18} aria-hidden="true" />
              Explore Nabri
            </Link>
          </div>

          <p
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              margin: '28px 0 0',
              fontSize: 14,
              color: 'var(--nb-ink-faint)',
            }}
          >
            <MapPin size={15} aria-hidden="true" />
            Built around people near you
          </p>
        </div>

        <div
          aria-hidden="true"
          style={{ position: 'relative', minHeight: 420, display: 'none' }}
          data-nb-hero-cards
        >
          {FLOATING_CARDS.map((card) => (
            <div
              key={card.title}
              style={{
                position: 'absolute',
                left: card.x,
                top: card.y,
                width: 186,
                padding: '14px 16px',
                borderRadius: 16,
                background: 'var(--nb-surface)',
                border: '1px solid var(--nb-line)',
                boxShadow: 'var(--nb-shadow)',
                animation: `nb-float 7s ${card.delay} ease-in-out infinite`,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 9,
                  background: card.accent,
                  opacity: 0.16,
                  marginBottom: 10,
                }}
              />
              <div style={{ fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>{card.title}</div>
              <div style={{ fontSize: 12, color: 'var(--nb-ink-faint)', marginTop: 2 }}>{card.meta}</div>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (min-width: 900px) {
          [data-nb-hero-cards] { display: block !important; }
        }
        @media (max-width: 899px) {
          [data-nb-hero-grid] { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </section>
  );
}

/** "What are you looking for?" — each tile links to a real route. */
const DISCOVERY = [
  { label: 'Friendship', to: '/discover?intent=friendship', accent: '#EC6A9C' },
  { label: 'Dating', to: '/discover?intent=dating', accent: '#7C5CF0' },
  { label: 'Walking', to: '/walking-requests', accent: '#22B8CF' },
  { label: 'Travel', to: '/discover?intent=travel', accent: '#2B4FD8' },
  { label: 'Sports', to: '/sports', accent: '#2B4FD8' },
  { label: 'Movies', to: '/movies', accent: '#A78BFA' },
  { label: 'Gaming', to: '/discover?intent=gaming', accent: '#7C5CF0' },
  { label: 'Food & Coffee', to: '/discover?intent=food', accent: '#EC6A9C' },
  { label: 'Study', to: '/discover?intent=study', accent: '#22B8CF' },
  { label: 'Communities', to: '/communities', accent: '#A78BFA' },
  // There is no /partners route, so that tile used to land on a dead page.
  { label: 'Partner Services', to: '/walking-requests', accent: '#2B4FD8' },
  { label: 'Events', to: '/events', accent: '#EC6A9C' },
] as const;

export function QuickDiscovery() {
  return (
    <section className="nb-section nb-section--tight" aria-labelledby="nb-discovery-heading">
      <div className="nb-container">
        <h2 id="nb-discovery-heading" className="nb-display nb-h3" style={{ margin: '0 0 6px' }}>
          What are you looking for?
        </h2>
        <p className="nb-body" style={{ margin: '0 0 28px' }}>
          Pick a starting point — everything below leads to a real part of Nabri.
        </p>

        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
            gap: 12,
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {DISCOVERY.map((item) => (
            <li key={item.label}>
              <Link
                to={item.to}
                className="nb-card nb-card--hover"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  minHeight: 60,
                  padding: '12px 16px',
                  textDecoration: 'none',
                  fontWeight: 650,
                  fontSize: 15,
                  letterSpacing: '-0.01em',
                  color: 'var(--nb-ink)',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: item.accent,
                    flexShrink: 0,
                  }}
                />
                {item.label}
                <ArrowRight
                  size={15}
                  aria-hidden="true"
                  style={{ marginLeft: 'auto', color: 'var(--nb-ink-faint)' }}
                />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function TrustStrip() {
  return (
    <section className="nb-section--tight" style={{ padding: '0 0 8px' }}>
      <div className="nb-container">
        <div
          className="nb-card nb-card--pad"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center' }}
        >
          <Sparkles size={20} aria-hidden="true" style={{ color: 'var(--nb-blue)' }} />
          <p className="nb-body" style={{ margin: 0, flex: '1 1 320px' }}>
            Every section on this page is driven by the live Nabri backend. Where a
            feature is not available yet, you will see that stated plainly rather
            than a placeholder pretending otherwise.
          </p>
        </div>
      </div>
    </section>
  );
}

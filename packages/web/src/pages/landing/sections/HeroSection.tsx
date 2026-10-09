/**
 * The hero.
 *
 * Two things here are worth reading closely.
 *
 * **The phone screen shows real rows.** It reads the same `/public/events`
 * response the events section does, so the mock cannot drift from the product -
 * when there are no events the phone says so instead of showing a festival that
 * does not exist.
 *
 * **The floating labels are gone.** The reference had four of them reading
 * "New Connection", "Music Festival", "Community", "Movie Night" over a
 * gradient. Those are claims about activity that the API does not support, so
 * what is left instead is a real count of what the server returned.
 */
import { CalendarDays, Download, Film, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { PLAY_STORE_URL } from '../../../lib/appLinks';
import { Backdrop } from '../components/Backdrop';
import { Brand } from '../components/SiteChrome';
import { StateBlock } from '../components/StateBlock';
import {
  formatEventDate,
  formatPlanPrice,
  formatPrice,
  imageUrl,
  initialsOf,
  type Plan,
  type PublicEvent,
  type Resource,
} from '../hooks/useLandingContent';

interface HeroProps {
  events: Resource<{ items: PublicEvent[] }>;
  /** The real plans, so the offer headline reads from the database. */
  plans: Plan[];
  signedIn: boolean;
}

function PhoneRow({ event }: { event: PublicEvent }) {
  const avatar = imageUrl(event.organizer?.avatarUrl ?? null);
  const price = formatPrice(event.price, event.currency);

  return (
    <div className="nb-mini">
      <span className="nb-mini-av">
        {avatar ? (
          <img src={avatar} alt="" loading="lazy" decoding="async" />
        ) : (
          initialsOf(event.organizer?.fullName ?? event.title) || '·'
        )}
      </span>
      <span style={{ minWidth: 0 }}>
        <b>{event.title}</b>
        <small>
          {[event.location ?? (event.isOnline ? 'Online' : null), price]
            .filter(Boolean)
            .join(' · ') || formatEventDate(event.startTime, event.timezone)}
        </small>
      </span>
    </div>
  );
}

export function HeroSection({ events, plans, signedIn }: HeroProps) {
  const items = events.data?.items ?? [];
  const top = items.slice(0, 3);
  // Longest trial on offer, and the cheapest plan, both from the server.
  const trialDays = plans.reduce((max, plan) => Math.max(max, plan.trialDays), 0);
  const cheapestPlan = [...plans].sort((a, b) => a.price - b.price)[0] ?? null;

  return (
    <section className="nb-section nb-hero" id="home" aria-labelledby="nb-hero-h">
      <Backdrop scene="hero" name="hero" />
      <div className="nb-veil nb-veil--hero" />

      <div className="nb-wrap nb-hero-grid">
        <div className="nb-rv">
          <Brand size={64} className="nb-logo--hero" />

          <h1 id="nb-hero-h">
            Meet People.
            <br />
            Discover <em>Experiences.</em>
            <br />
            Live More.
          </h1>

          <p className="nb-kicker">
            <span>Dating</span>
            <span>Friends</span>
            <span>Movies</span>
            <span>Events</span>
            <span>Sports</span>
            <span>Travel</span>
          </p>

          <p className="nb-lead">
            Nabri brings dating, friendship, activities, movies, sports, events, communities,
            travel and AI-powered discovery into one place.
          </p>

          <div className="nb-btns">
            <a
              className="nb-btn"
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Download aria-hidden="true" />
              {signedIn ? 'Open Nabri' : 'Try Nabri'}
            </a>
            <a className="nb-btn nb-btn--ghost" href="#events">
              Explore the Future
            </a>
          </div>

          <div className="nb-badges">
            <span className="nb-badge">
              <ShieldCheck aria-hidden="true" /> KYC-verified members
            </span>
            <span className="nb-badge">
              <Users aria-hidden="true" /> Real accounts, not profiles
            </span>
            <span className="nb-badge">
              <CalendarDays aria-hidden="true" /> Events in your area
            </span>
            <span className="nb-badge">
              <Film aria-hidden="true" /> Films with booking links
            </span>
          </div>

          {/* The offer. `trialDays` and the headline are both read from the
              plan the server returned, so this cannot say seven days while the
              database says one. See `trialHeadline` in TrustSections. */}
          {trialDays > 0 ? (
            <aside className="nb-offer" aria-label="Launch offer">
              <span className="nb-offer-label">LAUNCH OFFER</span>
              <h4>YOUR FIRST DAY</h4>
              <p className="nb-offer-huge">
                {trialDays} DAY{trialDays === 1 ? '' : 'S'} FREE
              </p>
              <p>
                Join now and your first {trialDays === 1 ? 'day is' : 'days are'} on us. Plans
                start at {formatPlanPrice(cheapestPlan)}.
              </p>
              <a
                className="nb-btn"
                href={PLAY_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get Nabri
              </a>
              <span className="nb-offer-note">
                Trial length comes from the live plan record, not from this page.
              </span>
            </aside>
          ) : null}
        </div>

        {/* The device mock. Fed entirely by the live feed - see the file note. */}
        <div className="nb-stage nb-rv" aria-hidden="true">
          <div className="nb-phone">
            <div className="nb-phone-back" />
            <div className="nb-phone-side" />
            <div className="nb-phone-side nb-phone-side--left" />
            <div className="nb-phone-frame">
              <div className="nb-notch" />
              <div className="nb-screen">
                <Brand size={20} />
                <h3>Nearby on Nabri</h3>
                <p className="nb-screen-tag">
                  {events.loading
                    ? 'Checking what is on…'
                    : items.length > 0
                      ? `${items.length} event${items.length === 1 ? '' : 's'} from the live feed`
                      : 'Live feed'}
                </p>

                {events.loading || events.error || top.length === 0 ? (
                  <div style={{ width: '100%', marginTop: 8 }}>
                    <StateBlock
                      resource={events}
                      subject="events"
                      emptyBody="No events are published right now. The feed updates as soon as an organiser adds one."
                    />
                  </div>
                ) : (
                  top.map((event) => <PhoneRow key={event.id} event={event} />)
                )}

                <span className="nb-pill">
                  <Sparkles aria-hidden="true" style={{ width: 14, height: 14 }} /> Browse all
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

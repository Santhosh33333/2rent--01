/**
 * New landing sections: discovery, features, how-it-works, closing CTA.
 *
 * Two interaction ideas carry the page:
 *
 *   - The discovery grid is a set of TiltCards. Hovering tips each one toward
 *     the pointer and pressing pushes it back in Z.
 *   - The feature cards are FlipCards. Clicking one turns it over in 3D to show
 *     what it actually does, which is the detail that used to be three
 *     paragraphs of static prose nobody read.
 *
 * Copy rule, same as the rest of the landing page: every tile links to a route
 * that exists, and nothing advertises a capability the backend cannot serve.
 */
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Calendar,
  Compass,
  Heart,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { FlipCard, TiltCard } from './motion3d';
import { DISCOVERY } from './discovery';

/** Tilt grid. Pointer-tracked 3D, one listener per card. */
export function DiscoveryGrid() {
  return (
    <section className="nb-section nb-section--tight" aria-labelledby="nb-v2-discovery">
      <div className="nb-container">
        <header className="nb-section__head">
          <h2 id="nb-v2-discovery" className="nb-display nb-h3">
            What are you looking for?
          </h2>
          <p className="nb-body">
            Pick a starting point — every tile below leads to a real part of Nabri.
          </p>
        </header>

        <ul className="nb-discovery nb-stagger">
          {DISCOVERY.map((item) => (
            <li key={item.label}>
              <TiltCard to={item.to} className="nb-discovery__card" max={12}>
                <span className="nb-discovery__dot" style={{ background: item.accent }} />
                <span className="nb-discovery__label">{item.label}</span>
                <ArrowRight size={16} aria-hidden="true" className="nb-discovery__arrow" />
              </TiltCard>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const FEATURES = [
  {
    icon: Users,
    title: 'Friendship that starts somewhere',
    lead: 'Find people near you who are up for the same thing you are.',
    detail:
      'Filters narrow by intent, distance and availability rather than by follower count, so a search returns people you could actually meet this week.',
    tint: '#2B4FD8',
  },
  {
    icon: Heart,
    title: 'Dating on your own terms',
    lead: 'Swipe, match and meet — with your visibility always under your control.',
    detail:
      'Who can see your profile, and who can message you first, are both explicit settings. Nothing is broadcast by default.',
    tint: '#EC6A9C',
  },
  {
    icon: Calendar,
    title: 'Events that fill up',
    lead: 'Browse what is happening nearby and take a spot.',
    detail:
      'Event detail pages are open to anyone, so a shared link never lands a visitor on a login wall. Joining is what needs an account.',
    tint: '#7C5CF0',
  },
  {
    icon: Compass,
    title: 'Activities, not just profiles',
    lead: 'Walking groups, sports and meetups you can join today.',
    detail:
      'An activity with a time and a place is easier to say yes to than a profile. Walking requests and sports listings are first-class, not posts.',
    tint: '#22B8CF',
  },
  {
    icon: MessageCircle,
    title: 'Communities that stay',
    lead: 'Ongoing groups instead of one-off posts that scroll away.',
    detail:
      'Communities keep their own feed, so a group you join in March still has a conversation in it in September.',
    tint: '#A78BFA',
  },
  {
    icon: ShieldCheck,
    title: 'Safety you can point at',
    lead: 'Verification and a real support desk, described in plain words.',
    detail:
      'The support desk and the founder contact are both published on every page, with a named legal entity behind them.',
    tint: '#0E9F6E',
  },
] as const;

/** Flip grid. Click a card to turn it over in 3D. */
export function FeatureGrid() {
  return (
    <section className="nb-section" aria-labelledby="nb-v2-features">
      <div className="nb-container">
        <header className="nb-section__head">
          <p className="nb-eyebrow">What Nabri does</p>
          <h2 id="nb-v2-features" className="nb-display nb-h2">
            Everything in one place, not five apps.
          </h2>
          <p className="nb-body">
            Tap a card to turn it over.
          </p>
        </header>

        <ul className="nb-feature-grid nb-stagger">
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <FlipCard
                className="nb-feature"
                flipLabel={`${feature.title}. ${feature.lead}`}
                front={
                  <>
                    <span className="nb-feature__icon" style={{ background: `${feature.tint}1f`, color: feature.tint }}>
                      <feature.icon size={20} aria-hidden="true" />
                    </span>
                    <span className="nb-feature__title">{feature.title}</span>
                    <span className="nb-feature__lead">{feature.lead}</span>
                    <span className="nb-feature__cue" aria-hidden="true">
                      Turn over
                    </span>
                  </>
                }
                back={<span className="nb-feature__detail">{feature.detail}</span>}
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: '01',
    title: 'Create an account',
    body: 'Email or mobile. You pick what is visible and what is not, at this point rather than after.',
  },
  {
    n: '02',
    title: 'Tell it what you want',
    body: 'Friendship, dating, walking, sports, communities. One account, several intents.',
  },
  {
    n: '03',
    title: 'Actually turn up',
    body: 'Join an event, accept a walk, message the person who answered. The app is the on-ramp, not the destination.',
  },
] as const;

export function HowItWorks() {
  return (
    <section className="nb-section" aria-labelledby="nb-v2-steps">
      <div className="nb-container">
        <header className="nb-section__head">
          <h2 id="nb-v2-steps" className="nb-display nb-h2">
            Three steps, then real people.
          </h2>
        </header>

        <ol className="nb-steps nb-3d-scene nb-stagger">
          {STEPS.map((step) => (
            <li key={step.n} className="nb-step">
              <span className="nb-step__n">{step.n}</span>
              <h3 className="nb-step__title">{step.title}</h3>
              <p className="nb-step__body">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/**
 * Closing CTA.
 *
 * The supporting line is the same promise the hero makes, and it is the one
 * thing on the page that must stay literally true: every section below is fed
 * by the live backend, and anything unavailable says so instead of pretending.
 */
export function ClosingCta() {
  return (
    <section className="nb-section" aria-labelledby="nb-v2-cta">
      <div className="nb-container">
        <div className="nb-cta nb-reveal">
          <p className="nb-eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            Ready when you are
          </p>
          <h2 id="nb-v2-cta" className="nb-display nb-h2">
            Good things happen nearby.
          </h2>
          <p className="nb-body">
            Every section on this page is driven by the live Nabri backend. Where a feature is not
            available yet, you will see that stated plainly rather than a placeholder pretending
            otherwise.
          </p>
          <div className="nb-cta__actions">
            <Link className="nb-btn nb-btn--primary nb-btn--lg nb-press" to="/register">
              Create Account
            </Link>
            <Link className="nb-btn nb-btn--secondary nb-btn--lg nb-press" to="/download">
              Get the App
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
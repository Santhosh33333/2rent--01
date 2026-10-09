/**
 * Landing sections that place the individual pillars inside one product, and
 * the beta programme that invites people to try it.
 *
 * "What is Nabri?" exists because the rest of the page explains dating, events,
 * movies and communities one at a time but never says, in one place, that they
 * are a single app. Every card carries an honest status - Live, In beta, Coming
 * soon - so nothing here reads as shipped when it is not. This is deliberately a
 * compact grid rather than twelve full-height sections: the page makes its point
 * without turning into a wall of cards.
 *
 * The beta band points only at destinations that actually exist: the two public
 * forms shipped in `public/` and the canonical Play listing. No route is
 * invented and no button is dead.
 */
import type { ReactNode } from 'react';
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Compass,
  Film,
  Footprints,
  Heart,
  MessageCircle,
  Plane,
  Rocket,
  ShieldCheck,
  Smile,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { PLAY_STORE_URL } from '../../../lib/appLinks';

type Stage = 'live' | 'beta' | 'soon';

const STAGE_LABEL: Record<Stage, string> = {
  live: 'Live',
  beta: 'In beta',
  soon: 'Coming soon',
};

const STAGE_ICON: Record<Stage, ReactNode> = {
  live: <CheckCircle2 aria-hidden="true" />,
  beta: <Sparkles aria-hidden="true" />,
  soon: <Rocket aria-hidden="true" />,
};

interface EcoItem {
  stage: Stage;
  icon: ReactNode;
  title: string;
  body: string;
}

const ECOSYSTEM: EcoItem[] = [
  {
    stage: 'live',
    icon: <Users aria-hidden="true" />,
    title: 'People & friends',
    body: 'Discover people nearby who share your interests and start a friendship, not just a follow.',
  },
  {
    stage: 'live',
    icon: <Heart aria-hidden="true" />,
    title: 'Dating',
    body: 'Verified profiles, distance bands instead of addresses, and a match only when the interest is mutual.',
  },
  {
    stage: 'live',
    icon: <Footprints aria-hidden="true" />,
    title: 'Activities',
    body: 'Walking, running, cycling, badminton, football and more — create one or join one near you.',
  },
  {
    stage: 'live',
    icon: <Film aria-hidden="true" />,
    title: 'Movies',
    body: 'What is in cinemas now and next, and movie plans with people who want to watch the same film.',
  },
  {
    stage: 'live',
    icon: <Trophy aria-hidden="true" />,
    title: 'Sports',
    body: 'Find sports events and play partners around you, and put a team together for the evening.',
  },
  {
    stage: 'live',
    icon: <CalendarDays aria-hidden="true" />,
    title: 'Events',
    body: 'Concerts, meetups and workshops to browse, RSVP to, or host yourself.',
  },
  {
    stage: 'live',
    icon: <MessageCircle aria-hidden="true" />,
    title: 'Communities',
    body: 'Groups around the things you care about, with member-led joining and their own chat.',
  },
  {
    stage: 'live',
    icon: <ShieldCheck aria-hidden="true" />,
    title: 'Safety centre',
    body: 'Verification, reporting, SOS and privacy controls, gathered in one place.',
  },
  {
    stage: 'beta',
    icon: <Bot aria-hidden="true" />,
    title: 'Nabri assistant',
    body: 'Ask in plain language to find people, events and things to do, answered from your real account.',
  },
  {
    stage: 'beta',
    icon: <Compass aria-hidden="true" />,
    title: 'Personalized discovery',
    body: 'Recommendations that learn from what you actually do, with controls to reset them any time.',
  },
  {
    stage: 'soon',
    icon: <Smile aria-hidden="true" />,
    title: 'AI dating',
    body: 'Conversation starters, date ideas, and a plain explanation of why someone was suggested.',
  },
  {
    stage: 'soon',
    icon: <Plane aria-hidden="true" />,
    title: 'Travel',
    body: 'Find travel companions and plan trips with people heading the same way.',
  },
];

export function WhatIsNabriSection() {
  return (
    <section
      className="nb-section nb-info nb-info--eco"
      id="what-is-nabri"
      aria-labelledby="nb-eco-h"
    >
      <div className="nb-wrap">
        <header className="nb-info-head nb-rv">
          <p className="nb-eyebrow">What is Nabri?</p>
          <h2 id="nb-eco-h">One app for every side of life</h2>
          <p className="nb-body nb-info-sub">
            Dating, friendship, activities, movies, sports, events, communities and travel, plus an
            AI that helps you find your way — one product, not ten apps. Everything is labelled by
            the status it is really in, so you always know what is live and what is still coming.
          </p>
        </header>

        <ul className="nb-eco">
          {ECOSYSTEM.map((item) => (
            <li className={`nb-eco-item nb-eco-item--${item.stage} nb-rv`} key={item.title}>
              <span className="nb-eco-icon" aria-hidden="true">
                {item.icon}
              </span>
              <span className="nb-eco-pill">
                {STAGE_ICON[item.stage]}
                {STAGE_LABEL[item.stage]}
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function BetaSection() {
  return (
    <section className="nb-section nb-info nb-info--beta" id="beta" aria-labelledby="nb-beta-h">
      <div className="nb-wrap">
        <header className="nb-info-head nb-rv">
          <p className="nb-eyebrow">
            <Sparkles aria-hidden="true" /> Testing / beta
          </p>
          <h2 id="nb-beta-h">Help shape what comes next</h2>
          <p className="nb-body nb-info-sub">
            Nabri is growing in the open. Install the app, try what is live today, and tell us what
            to fix or build next. Beta testers are the first to see new features.
          </p>
        </header>

        <div className="nb-btns nb-info-cta nb-rv">
          <a
            className="nb-btn nb-btn--lg"
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Get it on Google Play
          </a>
          <a className="nb-btn nb-btn--ghost nb-btn--lg" href="/beta-tester.html">
            Join the beta
          </a>
          <a className="nb-btn nb-btn--ghost nb-btn--lg" href="/app-feedback.html">
            Send feedback
          </a>
        </div>
      </div>
    </section>
  );
}

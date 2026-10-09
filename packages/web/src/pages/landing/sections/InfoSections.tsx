/**
 * Supporting landing sections: how it works, where the product is heading,
 * the in-app assistant, and questions people actually ask.
 *
 * Everything here follows the same rule as the pillars: it describes the
 * product that exists and links to real routes. The assistant block points at
 * `/ai`, which is a shipped route backed by `/api/agent`, and it does not fake a
 * chat transcript - a marketing page that shows a robot saying things it cannot
 * say is worse than showing nothing.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  Bot,
  CalendarDays,
  CheckCircle2,
  Compass,
  Heart,
  HelpCircle,
  MapPin,
  MessageCircle,
  Rocket,
  Smartphone,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { PLAY_STORE_URL } from '../../../lib/appLinks';

/* ------------------------------------------------------------------ */
/* How Nabri works                                                     */
/* ------------------------------------------------------------------ */

interface Step {
  icon: ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <UserPlus aria-hidden="true" />,
    title: 'Create your account',
    body: 'Sign up with email or Google in under a minute. Your account is verified before you can meet or message anyone.',
  },
  {
    icon: <Heart aria-hidden="true" />,
    title: 'Say what you are into',
    body: 'Set your interests, the distance you are happy with and what you are looking for. Nothing is a guess after this.',
  },
  {
    icon: <Compass aria-hidden="true" />,
    title: 'Discover what is near',
    body: 'People, events, communities and films around you, all in one feed. Discovery uses the preferences you set.',
  },
  {
    icon: <MessageCircle aria-hidden="true" />,
    title: 'Match and chat',
    body: 'Like the people you want to meet. When the interest is mutual you get a match, and the conversation opens.',
  },
  {
    icon: <CalendarDays aria-hidden="true" />,
    title: 'Plan something real',
    body: 'Join an event, start your own, RSVP, or get cinema tickets through our ticketing partner.',
  },
  {
    icon: <MapPin aria-hidden="true" />,
    title: 'Meet safely',
    body: 'You see a distance band, never an address. Every profile is tied to a verified account, and you stay in control of what you share.',
  },
  {
    icon: <Sparkles aria-hidden="true" />,
    title: 'Ask Nabri when stuck',
    body: 'A question is faster than a menu. The in-app assistant answers from your real account, in plain language.',
  },
];

export function HowItWorksSection() {
  return (
    <section className="nb-section nb-info" id="how-it-works" aria-labelledby="nb-how-h">
      <div className="nb-wrap">
        <header className="nb-info-head nb-rv">
          <p className="nb-eyebrow">How it works</p>
          <h2 id="nb-how-h">From hello to plans in seven steps</h2>
          <p className="nb-body nb-info-sub">
            Nabri keeps discovery, matching, planning and meeting in one place, so you never have
            to leave the app to make something happen.
          </p>
        </header>

        <ol className="nb-steps">
          {STEPS.map((step, index) => (
            <li className="nb-step nb-rv" key={step.title}>
              <span className="nb-step-num" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className="nb-step-icon" aria-hidden="true">
                {step.icon}
              </span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="nb-btns nb-info-cta">
          <a
            className="nb-btn"
            href={PLAY_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Smartphone aria-hidden="true" /> Get Nabri on Google Play
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Future vision                                                       */
/* ------------------------------------------------------------------ */

type Stage = 'live' | 'beta' | 'soon';

interface VisionItem {
  stage: Stage;
  title: string;
  body: string;
}

const STAGE_LABEL: Record<Stage, string> = {
  live: 'Live',
  beta: 'In beta',
  soon: 'Coming soon',
};

const VISION: VisionItem[] = [
  {
    stage: 'live',
    title: 'Dating',
    body: 'Nearby people, verified accounts, distance bands instead of addresses.',
  },
  {
    stage: 'live',
    title: 'Events',
    body: 'Concerts, meetups and workshops you can browse, join or create.',
  },
  {
    stage: 'live',
    title: 'Communities',
    body: 'Groups around the things you care about, with member-led joining.',
  },
  {
    stage: 'live',
    title: 'Movies',
    body: 'What is in cinemas now and what opens next, with ticket links.',
  },
  {
    stage: 'live',
    title: 'Nabri assistant',
    body: 'An in-app assistant that answers from your real account, safely.',
  },
  {
    stage: 'beta',
    title: 'Smarter discovery',
    body: 'Richer filters and recommendations built from the preferences you set, rolling out gradually.',
  },
  {
    stage: 'soon',
    title: 'More cities',
    body: 'Widening coverage beyond the neighbourhoods that are live today.',
  },
  {
    stage: 'soon',
    title: 'iPhone app',
    body: 'Nabri is Android-first. An iOS build is planned; there is no date to promise yet.',
  },
];

const STAGE_ICON: Record<Stage, ReactNode> = {
  live: <CheckCircle2 aria-hidden="true" />,
  beta: <Sparkles aria-hidden="true" />,
  soon: <Rocket aria-hidden="true" />,
};

export function FutureVisionSection() {
  return (
    <section className="nb-section nb-info nb-info--vision" id="vision" aria-labelledby="nb-vision-h">
      <div className="nb-wrap">
        <header className="nb-info-head nb-rv">
          <p className="nb-eyebrow">Where this is going</p>
          <h2 id="nb-vision-h">What is live, what is next</h2>
          <p className="nb-body nb-info-sub">
            We label everything by honest status. Live means shipped and in the app today. In beta
            means rolling out. Coming soon means planned, with no date we would not want to break.
          </p>
        </header>

        <ul className="nb-vision">
          {VISION.map((item) => (
            <li className={`nb-vision-item nb-vision-item--${item.stage} nb-rv`} key={item.title}>
              <span className="nb-vision-pill">
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

/* ------------------------------------------------------------------ */
/* Ask Nabri                                                           */
/* ------------------------------------------------------------------ */

const ASK_PROMPTS = [
  'Find friends who like cricket',
  'Find a movie for tonight',
  'Show events near me this weekend',
  'Find a walking group',
  'Find communities I may like',
  'Plan my weekend',
];

/**
 * A fixed example exchange, labelled as a demo in the UI.
 *
 * It deliberately makes no claim that could be false: it never names a film,
 * venue, price or person, because the assistant must not invent those and this
 * marketing sample must not either. Every sentence describes what the real
 * assistant can do with real data.
 */
const ASK_DEMO = [
  { role: 'user', text: 'Find a movie for tonight.' },
  {
    role: 'ai',
    text: 'Here are the films playing near you tonight. Pick one and I can start a movie plan, or show you people who want to watch it too.',
  },
  { role: 'user', text: 'Anything for the weekend?' },
  {
    role: 'ai',
    text: 'I can put together a weekend plan from real events, activities and films near you. Tell me what you enjoy and I will draft one you can edit.',
  },
] as const;

export function AskNabriSection() {
  return (
    <section className="nb-section nb-info nb-info--ask" id="ask-nabri" aria-labelledby="nb-ask-h">
      <div className="nb-wrap nb-ask-grid">
        <div className="nb-ask-copy nb-rv">
          <p className="nb-eyebrow">Ask Nabri</p>
          <h2 id="nb-ask-h">A question is faster than a menu</h2>
          <p className="nb-body nb-info-sub">
            The in-app assistant answers from your real account — the people, events, films and
            activities that actually exist near you. Ask for what you want in plain language,
            and it turns your words into real filters and real results, not a chatbot guessing
            from a help page.
          </p>
          <p className="nb-body nb-info-sub">
            It never invents a person, venue, price or showtime. If there is nothing real to show,
            it says so — and anything that messages someone, publishes or spends asks you to
            confirm first.
          </p>

          <div className="nb-btns">
            <Link className="nb-btn nb-btn--teal" to="/ai">
              <Bot aria-hidden="true" /> Try the assistant
            </Link>
            <Link className="nb-btn nb-btn--ghost" to="/login">
              Sign in first
            </Link>
          </div>
        </div>

        <div className="nb-ask-side nb-rv">
          <div className="nb-ask-card">
            <p className="nb-ask-card-head">
              <Bot aria-hidden="true" /> Example conversation
              <span className="nb-demo-tag">Demo</span>
            </p>
            <ol className="nb-demo">
              {ASK_DEMO.map((t, index) => (
                <li className={`nb-demo-turn nb-demo-turn--${t.role}`} key={index}>
                  <span className="nb-demo-who">{t.role === 'user' ? 'You' : 'Nabri AI'}</span>
                  <p>{t.text}</p>
                </li>
              ))}
            </ol>
            <p className="nb-demo-note">
              Example only — this sample is not connected to live accounts. The real assistant
              answers from your account and never invents people, events, venues or prices.
            </p>
          </div>

          <div className="nb-ask-card">
            <p className="nb-ask-card-head">
              <Sparkles aria-hidden="true" /> Things people ask
            </p>
            <ul>
              {ASK_PROMPTS.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* FAQ                                                                 */
/* ------------------------------------------------------------------ */

interface Faq {
  q: string;
  a: ReactNode;
}

const FAQS: Faq[] = [
  {
    q: 'Is Nabri free?',
    a: (
      <>
        You can create an account and explore for free. Some features — like the dating window —
        run on a plan with a trial. Current pricing and the trial length are shown on the{' '}
        <Link to="/#download">subscription section</Link> of this page.
      </>
    ),
  },
  {
    q: 'Which phones can run Nabri?',
    a: (
      <>
        Nabri is Android-first and installs from Google Play. An iPhone build is planned but has no
        release date yet.
      </>
    ),
  },
  {
    q: 'Does Nabri share my exact location?',
    a: (
      <>
        No. You see and share a distance band, never a street address. Precise coordinates are not
        published to other people on the platform.
      </>
    ),
  },
  {
    q: 'How do you keep profiles real?',
    a: (
      <>
        Accounts are verified, and some parts of the app require identity checks (KYC) before they
        unlock. Reporting is built in, and we act on reports.
      </>
    ),
  },
  {
    q: 'Can the assistant spend my money?',
    a: (
      <>
        No. The assistant can read your account to answer questions, but anything that moves money
        or contacts another person asks you to confirm first.
      </>
    ),
  },
  {
    q: 'How do I delete my account?',
    a: (
      <>
        Once signed in, you can request deletion from your privacy settings. Data handling is
        described in the <Link to="/privacy">privacy policy</Link>.
      </>
    ),
  },
];

export function FaqSection() {
  return (
    <section className="nb-section nb-info nb-info--faq" id="faq" aria-labelledby="nb-faq-h">
      <div className="nb-wrap">
        <header className="nb-info-head nb-rv">
          <p className="nb-eyebrow">
            <HelpCircle aria-hidden="true" /> Questions
          </p>
          <h2 id="nb-faq-h">The things people ask first</h2>
        </header>

        <div className="nb-faq nb-rv">
          {FAQS.map((item) => (
            <details className="nb-faq-item" key={item.q}>
              <summary>
                <span>{item.q}</span>
                <span className="nb-faq-mark" aria-hidden="true">
                  +
                </span>
              </summary>
              <div className="nb-faq-body">{item.a}</div>
            </details>
          ))}
        </div>

        <p className="nb-faq-foot nb-rv">
          Still stuck? <a href="/app-feedback.html">Send feedback</a> or{' '}
          <Link to="/login">sign in</Link> and ask the assistant.
        </p>
      </div>
    </section>
  );
}

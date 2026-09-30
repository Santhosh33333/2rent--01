/**
 * Feature grid, how-it-works, AI section and closing CTA for the public landing
 * page.
 *
 * Two things this file deliberately does not do:
 *
 *  - It does not use stock photography. There is no licensed image library in the
 *    repo, and inventing photo URLs would ship broken or misleading images to a
 *    store reviewer. The "imagery" is inline SVG built from the product's own
 *    brand colours, so it renders offline, weighs nothing, and cannot 404.
 *  - It does not claim features that do not exist. Every tile names something
 *    that is actually built and routed. Where a capability is real but still in
 *    progress, the tile says so.
 *
 * Motion is CSS-only and gated on `prefers-reduced-motion`, so nothing here
 * depends on JS to finish animating and users who ask for less motion get a
 * static page.
 */
import { Link } from 'react-router-dom';
import {
  Bot, ShieldCheck, MapPin, Users, CalendarDays, MessageCircle,
  Wallet, Sparkles, ArrowRight, Zap, Lock, HeartHandshake,
} from 'lucide-react';

type Icon = typeof Bot;

interface Feature {
  icon: Icon;
  title: string;
  body: string;
  to: string;
  cta: string;
  tint: string;
}

const FEATURES: Feature[] = [
  {
    icon: MapPin,
    title: 'Discover people nearby',
    body: 'Browse people around you by intent — friendship, dating, travel, sports, gaming, study or food. Filtered by city so results stay relevant.',
    to: '/discover',
    cta: 'Explore discovery',
    tint: '#2B4FD8',
  },
  {
    icon: CalendarDays,
    title: 'Events that show real status',
    body: 'Create and join events with live, upcoming and past states driven by server time, not your device clock. See capacity, price and who is going.',
    to: '/events',
    cta: 'See events',
    tint: '#EC6A9C',
  },
  {
    icon: Wallet,
    title: 'Bookings, wallet and payouts',
    body: 'Pay securely through Cashfree, track every booking, and manage wallet balance and partner withdrawals from one place.',
    to: '/download',
    cta: 'Get the app',
    tint: '#22B8CF',
  },
  {
    icon: HeartHandshake,
    title: 'Verified walking partners',
    body: 'Book a walking companion for a job or a stroll. Start and completion run on OTP, so a partner cannot begin or finish without you knowing.',
    to: '/walking-requests',
    cta: 'View walking',
    tint: '#7C5CF0',
  },
  {
    icon: MessageCircle,
    title: 'Messaging built in',
    body: 'Chat with people and partners in the app, attached to bookings where it matters, with report and block controls a click away.',
    to: '/download',
    cta: 'Start chatting',
    tint: '#A78BFA',
  },
  {
    icon: ShieldCheck,
    title: 'KYC and safety tools',
    body: 'Identity verification for trust, plus SOS, live location sharing with people you choose, and confidential reporting.',
    to: '/legal#safety',
    cta: 'Read safety details',
    tint: '#0F9D58',
  },
];

/**
 * Abstract product art. Pure SVG, no network fetch, no external asset. Each
 * panel is a different geometric composition so the row does not read as six
 * copies of the same gradient.
 */
function FeatureArt({ variant, tint }: { variant: number; tint: string }) {
  const id = `nb-art-${variant}`;
  return (
    <svg
      viewBox="0 0 320 180"
      role="img"
      aria-label=""
      style={{ display: 'block', width: '100%', height: 'auto' }}
    >
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={tint} stopOpacity="0.20" />
          <stop offset="100%" stopColor={tint} stopOpacity="0.04" />
        </linearGradient>
      </defs>
      <rect width="320" height="180" rx="18" fill={`url(#${id}-g)`} />

      {variant === 0 && (
        <g>
          <circle cx="96" cy="90" r="34" fill={tint} opacity="0.30" />
          <circle cx="150" cy="70" r="22" fill={tint} opacity="0.22" />
          <circle cx="196" cy="104" r="26" fill={tint} opacity="0.18" />
          <path d="M40 148 Q160 116 280 148" stroke={tint} strokeWidth="2" fill="none" opacity="0.4" strokeDasharray="6 8" />
        </g>
      )}
      {variant === 1 && (
        <g>
          <rect x="52" y="46" width="88" height="96" rx="12" fill={tint} opacity="0.26" />
          <rect x="156" y="62" width="112" height="80" rx="12" fill={tint} opacity="0.16" />
          <rect x="72" y="68" width="48" height="6" rx="3" fill={tint} opacity="0.5" />
          <rect x="72" y="84" width="34" height="6" rx="3" fill={tint} opacity="0.34" />
          <rect x="176" y="84" width="60" height="6" rx="3" fill={tint} opacity="0.4" />
        </g>
      )}
      {variant === 2 && (
        <g>
          <rect x="58" y="52" width="204" height="82" rx="14" fill={tint} opacity="0.20" />
          <rect x="76" y="72" width="76" height="10" rx="5" fill={tint} opacity="0.45" />
          <rect x="76" y="92" width="120" height="8" rx="4" fill={tint} opacity="0.26" />
          <rect x="76" y="110" width="54" height="8" rx="4" fill={tint} opacity="0.26" />
        </g>
      )}
      {variant === 3 && (
        <g>
          <circle cx="110" cy="90" r="30" fill={tint} opacity="0.28" />
          <circle cx="212" cy="90" r="30" fill={tint} opacity="0.18" />
          <path d="M146 90 h30" stroke={tint} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
          <path d="M168 82 l10 8 -10 8" stroke={tint} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
        </g>
      )}
      {variant === 4 && (
        <g>
          <path d="M60 60 h160 a12 12 0 0 1 12 12 v44 a12 12 0 0 1 -12 12 h-96 l-34 26 v-26 h-30 a12 12 0 0 1 -12 -12 v-44 a12 12 0 0 1 12 -12 z" fill={tint} opacity="0.20" />
          <rect x="80" y="84" width="120" height="7" rx="3.5" fill={tint} opacity="0.42" />
          <rect x="80" y="100" width="76" height="7" rx="3.5" fill={tint} opacity="0.26" />
        </g>
      )}
      {variant === 5 && (
        <g>
          <path d="M160 44 l44 16 v34 c0 26 -18 40 -44 48 -26 -8 -44 -22 -44 -48 v-34 z" fill={tint} opacity="0.22" />
          <path d="M142 90 l14 14 26 -28" stroke={tint} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
        </g>
      )}
    </svg>
  );
}

export function FeaturesSection() {
  return (
    <section className="nb-section" aria-labelledby="nb-features-heading">
      <div className="nb-container">
        <h2 id="nb-features-heading" className="nb-display nb-h2" style={{ margin: '0 0 8px' }}>
          Everything in one app
        </h2>
        <p className="nb-body" style={{ margin: '0 0 32px', maxWidth: '58ch' }}>
          Nabri is built around real parts of life, not a feed. Each card below is a
          working feature, not a promise.
        </p>

        <ul
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(288px, 1fr))',
            gap: 20,
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {FEATURES.map((feature, index) => {
            const IconCmp = feature.icon;
            return (
              <li key={feature.title}>
                <article
                  className="nb-card nb-card--hover nb-reveal"
                  style={{ overflow: 'hidden', height: '100%' }}
                >
                  <FeatureArt variant={index % 6} tint={feature.tint} />
                  <div style={{ padding: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          display: 'grid',
                          placeItems: 'center',
                          background: feature.tint,
                          color: '#fff',
                          flexShrink: 0,
                        }}
                      >
                        <IconCmp size={17} />
                      </span>
                      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 750, letterSpacing: '-0.015em', color: 'var(--nb-ink)' }}>
                        {feature.title}
                      </h3>
                    </div>

                    <p className="nb-body" style={{ margin: '0 0 16px', minHeight: '4.6em' }}>
                      {feature.body}
                    </p>

                    <Link
                      to={feature.to}
                      className="nb-footer__link"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 650, color: feature.tint }}
                    >
                      {feature.cta}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/**
 * Three-step "how it works". Deliberately plain: the point is that onboarding is
 * verifiable and OTP-gated, which is what differentiates a walking service from
 * a chat app.
 */
const STEPS = [
  {
    n: '01',
    title: 'Create your account',
    body: 'Sign up with your phone, verify it, and tell us what you are looking for — friendship, activity, travel or a walking partner.',
    icon: Users,
  },
  {
    n: '02',
    title: 'Verify and discover',
    body: 'Complete KYC so others know you are real. Then browse people, events and partners near you, or just ask the assistant.',
    icon: ShieldCheck,
  },
  {
    n: '03',
    title: 'Meet, book, stay safe',
    body: 'Chat, book and pay securely. Walking jobs run on start and completion OTP, so nobody can begin or finish without your confirmation.',
    icon: MapPin,
  },
] as const;

export function HowItWorksSection() {
  return (
    <section className="nb-section nb-section--tight" aria-labelledby="nb-how-heading">
      <div className="nb-container">
        <h2 id="nb-how-heading" className="nb-display nb-h3" style={{ margin: '0 0 6px' }}>
          How it works
        </h2>
        <p className="nb-body" style={{ margin: '0 0 28px', maxWidth: '52ch' }}>
          Three steps from install to a real meetup.
        </p>

        <ol
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))',
            gap: 20,
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {STEPS.map((step) => {
            const IconCmp = step.icon;
            return (
              <li
                key={step.n}
                className="nb-card nb-card--pad nb-reveal"
                style={{ position: 'relative', overflow: 'hidden' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    right: 14,
                    top: 2,
                    fontSize: 64,
                    fontWeight: 800,
                    letterSpacing: '-0.05em',
                    color: 'var(--nb-blue)',
                    opacity: 0.09,
                    lineHeight: 1,
                  }}
                >
                  {step.n}
                </span>

                <span
                  aria-hidden="true"
                  style={{
                    display: 'grid',
                    placeItems: 'center',
                    width: 38,
                    height: 38,
                    borderRadius: 11,
                    background: 'var(--nb-blue)',
                    color: '#fff',
                    marginBottom: 12,
                  }}
                >
                  <IconCmp size={18} />
                </span>

                <h3 style={{ margin: '0 0 6px', fontSize: 17, fontWeight: 700, color: 'var(--nb-ink)' }}>
                  {step.title}
                </h3>
                <p className="nb-body" style={{ margin: 0, fontSize: 14 }}>
                  {step.body}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/** Closing call to action, repeated once more at the end of a long page. */
export function FinalCtaSection() {
  return (
    <section className="nb-section nb-section--tight" aria-labelledby="nb-cta-heading">
      <div className="nb-container">
        <div
          className="nb-card nb-card--pad nb-reveal"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 24,
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(135deg, rgba(43,79,216,0.10), rgba(124,92,240,0.08))',
          }}
        >
          <div style={{ flex: '1 1 340px' }}>
            <h2 id="nb-cta-heading" className="nb-display nb-h3" style={{ margin: '0 0 6px' }}>
              Your people are closer than you think
            </h2>
            <p className="nb-body" style={{ margin: 0, maxWidth: '46ch' }}>
              Install Nabri, verify your account, and see who is actually around you today.
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <Link className="nb-btn nb-btn--primary nb-btn--lg" to="/download">
              Get the App
            </Link>
            <Link className="nb-btn nb-btn--secondary nb-btn--lg" to="/register">
              Create Account
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

const AI_CAPS = [
  {
    icon: Zap,
    title: 'Ask in plain language',
    body: '"Something to do near me tomorrow evening" returns real events, partners and people instead of a search box you have to learn.',
  },
  {
    icon: Users,
    title: 'Matches, not noise',
    body: 'Recommendations weigh the communities you joined and the events you attend, so results get sharper the more you use it.',
  },
  {
    icon: Bot,
    title: 'Suggestions and summaries',
    body: 'The assistant drafts event ideas, summarises long chats and explains bookings, then links you straight to the screen that does the work.',
  },
] as const;

export function AiSection() {
  return (
    <section className="nb-section" aria-labelledby="nb-ai-heading">
      <div className="nb-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 40,
            alignItems: 'center',
          }}
          data-nb-ai-grid
        >
          <div>
            <span className="nb-pill" style={{ marginBottom: 14 }}>
              <Sparkles size={12} aria-hidden="true" />
              AI assistant
            </span>

            <h2 id="nb-ai-heading" className="nb-display nb-h2" style={{ margin: '0 0 10px' }}>
              Ask Nabri what you actually want to do
            </h2>

            <p className="nb-body" style={{ margin: '0 0 22px', maxWidth: '50ch' }}>
              The in-app assistant answers with real data from your city and takes you
              straight to the booking, chat or event. It can recommend and summarise,
              but it never approves payments, verifies KYC or bypasses safety checks.
            </p>

            <Link className="nb-btn nb-btn--primary nb-btn--lg" to="/download">
              <NabriMarkInline />
              Try it in the app
            </Link>
          </div>

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'grid',
              gap: 14,
            }}
          >
            {AI_CAPS.map((cap) => {
              const IconCmp = cap.icon;
              return (
                <li key={cap.title} className="nb-card nb-card--pad">
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 10,
                        display: 'grid',
                        placeItems: 'center',
                        background: 'var(--nb-blue)',
                        color: '#fff',
                        flexShrink: 0,
                      }}
                    >
                      <IconCmp size={18} />
                    </span>
                    <div>
                      <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--nb-ink)' }}>
                        {cap.title}
                      </h3>
                      <p className="nb-body" style={{ margin: 0, fontSize: 14 }}>
                        {cap.body}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}

            <li
              className="nb-card nb-card--pad"
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: 'var(--nb-surface-sunk, #f8fafc)' }}
            >
              <span
                aria-hidden="true"
                style={{ width: 36, height: 36, borderRadius: 10, display: 'grid', placeItems: 'center', background: '#0F9D58', color: '#fff', flexShrink: 0 }}
              >
                <Lock size={18} />
              </span>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--nb-ink)' }}>
                  Guardrailed, not magic
                </h3>
                <p className="nb-body" style={{ margin: 0, fontSize: 14 }}>
                  AI output is never treated as confirmed fact. Authentication,
                  payment verification, KYC, admin permissions and safety controls all
                  stay with the server.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          [data-nb-ai-grid] { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </section>
  );
}

/** Local copy of the mark so this file has no import cycle with NabriLogo. */
function NabriMarkInline() {
  return (
    <svg width="20" height="20" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="currentColor" opacity="0.14" />
      <path
        d="M12 28V12l8 9 8-9v16"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

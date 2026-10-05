/**
 * Landing page block for the assistant.
 *
 * Why this is on a marketing page at all: the questions that make someone open
 * an app for the first time are mostly "can this actually do X for me", and the
 * assistant can answer those from the product it belongs to. A static FAQ can
 * only answer the questions someone remembered to write down.
 *
 * What it deliberately does NOT do is pretend to be the assistant. There is no
 * fake chat transcript and no canned typing animation pretending to answer -
 * a marketing page that shows a robot saying things it cannot say is worse than
 * showing nothing. This block describes the capability, links to the real thing,
 * and states the one constraint that matters: it reads your account, so it needs
 * you signed in.
 *
 * Sits immediately before SupportSection, because "ask a machine" followed by
 * "talk to a human" is the intended order and reversing it would read as
 * "there is no human".
 */
import { Link } from 'react-router-dom';
import { Bot, ShieldCheck, Wallet, CalendarCheck, Sparkles, ArrowRight, Zap } from 'lucide-react';

const CAPABILITIES = [
  {
    icon: Wallet,
    title: 'Your money, explained',
    body: 'Ask why a top-up is still pending or what a booking charged. It reads your wallet and tells you the actual state.',
  },
  {
    icon: CalendarCheck,
    title: 'Bookings without the guessing',
    body: 'Change a time, check whether a partner is assigned, cancel before the cut-off — in plain language, not form fields.',
  },
  {
    icon: Sparkles,
    title: 'Discovery that remembers you',
    body: 'Tell it what you are in the mood for and it uses the preferences you already set, not a fresh guess every time.',
  },
  {
    icon: ShieldCheck,
    title: 'Knows what it must not do',
    body: 'It reads. Anything that moves money or contacts someone asks you to confirm first, every time.',
  },
];

const SAMPLE = [
  'Why is my wallet top-up still pending?',
  'I need to cancel tomorrow’s booking.',
  'Which of my preferences are actually saved?',
];

export function AiSection() {
  return (
    <section className="nb-section" aria-labelledby="nb-ai-heading">
      <div className="nb-container">
        <div
          style={{
            display: 'grid',
            gap: 'clamp(28px, 5vw, 56px)',
            gridTemplateColumns: 'minmax(0, 1fr)',
            alignItems: 'center',
          }}
          className="nb-ai__layout"
        >
          <div className="nb-reveal">
            <p className="nb-eyebrow" style={{ margin: '0 0 12px' }}>
              Assistant
            </p>
            <h2 id="nb-ai-heading" className="nb-display nb-h2" style={{ margin: 0 }}>
              A question is faster than a menu.
            </h2>
            <p
              style={{
                margin: '14px 0 0',
                color: 'var(--nb-ink-soft)',
                fontSize: 16.5,
                lineHeight: 1.6,
                maxWidth: 560,
              }}
            >
              Nabri Assistant answers from your actual account — real wallet balance, real booking
              state, real preferences. Not a chatbot guessing from a help page.
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 24 }}>
              <Link to="/login" className="nb-btn nb-btn--primary">
                <Bot size={16} aria-hidden="true" />
                Try the assistant
              </Link>
              <Link to="/ai" className="nb-btn nb-btn--secondary">
                See what it can do
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>

            <p
              style={{
                margin: '16px 0 0',
                fontSize: 13,
                color: 'var(--nb-ink-soft)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <ShieldCheck size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
              It reads your account, so it needs you signed in. It cannot spend your money.
            </p>
          </div>

          {/*
            A real sample of the questions, not a mock conversation. Each chip is
            a prompt the assistant genuinely answers from account data, so
            copying one and asking it works.
          */}
          <div className="nb-reveal" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: 'clamp(20px, 3vw, 30px)',
                borderRadius: 'var(--nb-radius-lg, 18px)',
                background: 'var(--nb-surface-soft, #F8FAFC)',
                border: '1px solid var(--nb-border, #E2E8F0)',
              }}
            >
              <p
                style={{
                  margin: '0 0 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--nb-ink-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <Zap size={13} aria-hidden="true" />
                Things people ask
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 }}>
                {SAMPLE.map((q) => (
                  <li
                    key={q}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 9,
                      fontSize: 14.5,
                      color: 'var(--nb-ink)',
                      lineHeight: 1.5,
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        marginTop: 7,
                        width: 6,
                        height: 6,
                        borderRadius: 999,
                        background: 'var(--nb-blue, #3B82F6)',
                        flexShrink: 0,
                      }}
                    />
                    {q}
                  </li>
                ))}
              </ul>
            </div>

            <div className="nb-grid nb-grid--2" style={{ gap: 14 }}>
              {CAPABILITIES.map((c) => {
                const Icon = c.icon;
                return (
                  <div
                    key={c.title}
                    style={{
                      padding: '18px 20px',
                      borderRadius: 'var(--nb-radius-lg, 18px)',
                      background: 'var(--nb-surface, #FFFFFF)',
                      border: '1px solid var(--nb-border, #E2E8F0)',
                    }}
                  >
                    <span
                      className="nb-feature__icon"
                      style={{ background: 'var(--nb-violet, #8B5CF6)14', color: 'var(--nb-violet, #8B5CF6)' }}
                      aria-hidden="true"
                    >
                      <Icon size={18} />
                    </span>
                    <h3 style={{ margin: '12px 0 0', fontSize: 15.5, fontWeight: 700, color: 'var(--nb-ink)' }}>
                      {c.title}
                    </h3>
                    <p style={{ margin: '6px 0 0', fontSize: 13.5, color: 'var(--nb-ink-soft)', lineHeight: 1.55 }}>
                      {c.body}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
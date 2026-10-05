/**
 * Public support block.
 *
 * The support link used to drop a visitor on a route that either needed an
 * account or, worse, sent them into the store listing. Someone reading a
 * marketing page and asking "how do I talk to a human" should get an answer on
 * that page, not a download prompt.
 *
 * Everything here is a real, working destination: `/support` is a public route
 * that accepts a signed-in or anonymous request, the two mailboxes are the ones
 * published in the legal documents and the footer, and `/legal` carries the
 * full grievance and privacy policy.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { LifeBuoy, Mail, MessageCircle, ShieldQuestion, ArrowRight, Clock } from 'lucide-react';

const SUPPORT_EMAIL = 'nabri.support@gmail.com';
const FOUNDER_EMAIL = 'founder_nabri@zohomail.in';

/**
 * `accent` fills the icon chip, so it stays a saturated brand colour and is
 * never used as text.
 *
 * `ink` is the same hue resolved for text. It has to be a separate value: the
 * raw accents above are chosen to read as a chip fill on a light card, and as
 * text on the dark surface they fell to 2.8:1 — well under AA. These point at
 * the existing `--nb-cta-*` ramp, which is already defined per theme and
 * already carries AA against `--nb-surface` in both.
 */
const CHANNELS = [
  {
    icon: MessageCircle,
    title: 'Support desk',
    body: 'Raise a request in the browser. It reaches the same queue as an in-app ticket.',
    cta: 'Open support',
    to: '/support',
    accent: 'var(--nb-blue)',
    ink: 'var(--nb-cta-blue)',
  },
  {
    icon: Mail,
    title: 'Email support',
    body: 'For anything that needs attachments, screenshots or a paper trail.',
    cta: SUPPORT_EMAIL,
    href: `mailto:${SUPPORT_EMAIL}`,
    accent: '#0E9F6E',
    ink: 'var(--nb-cta-green)',
  },
  {
    icon: ShieldQuestion,
    title: 'Founder contact',
    body: 'Business, partnership and policy questions go straight to the founder.',
    cta: FOUNDER_EMAIL,
    href: `mailto:${FOUNDER_EMAIL}`,
    accent: '#7C3AED',
    ink: 'var(--nb-cta-violet)',
  },
] as const;

export function SupportSection() {
  useEffect(() => {
    // Count up is cosmetic and must not run for reduced-motion users.
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  }, []);

  return (
    <section className="nb-section" aria-labelledby="nb-support-heading">
      <div className="nb-container">
        <div style={{ maxWidth: 620, marginBottom: 32 }}>
          <p className="nb-eyebrow" style={{ margin: '0 0 12px' }}>
            Support
          </p>
          <h2 id="nb-support-heading" className="nb-display nb-h2" style={{ margin: 0 }}>
            Talk to a human, on the site.
          </h2>
          <p style={{ margin: '14px 0 0', color: 'var(--nb-ink-soft)', fontSize: 16.5, lineHeight: 1.6 }}>
            No ticket queue, no app install, no waiting for a store download. Pick whichever
            channel suits you and it lands with the same team.
          </p>
        </div>

        <div className="nb-grid nb-grid--3">
          {CHANNELS.map((channel) => {
            const Icon = channel.icon;
            const inner = (
              <>
                <span
                  className="nb-feature__icon"
                  style={{ background: `${channel.accent}14`, color: channel.accent }}
                  aria-hidden="true"
                >
                  <Icon size={19} />
                </span>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--nb-ink)' }}>
                  {channel.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--nb-ink-soft)', lineHeight: 1.55 }}>
                  {channel.body}
                </p>
                <span
                  style={{
                    marginTop: 4,
                    fontSize: 13.5,
                    fontWeight: 650,
                    color: channel.ink,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    wordBreak: 'break-all',
                  }}
                >
                  {channel.cta}
                  <ArrowRight size={14} aria-hidden="true" style={{ flexShrink: 0 }} />
                </span>
              </>
            );

            const style = {
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              alignItems: 'flex-start',
              textDecoration: 'none',
            } as const;

            return 'href' in channel && channel.href ? (
              <a
                key={channel.title}
                href={channel.href}
                className="nb-card nb-card--hover nb-card--pad nb-reveal"
                style={style}
              >
                {inner}
              </a>
            ) : (
              <Link
                key={channel.title}
                to={(channel as { to: string }).to}
                className="nb-card nb-card--hover nb-card--pad nb-reveal"
                style={style}
              >
                {inner}
              </Link>
            );
          })}
        </div>

        <div
          className="nb-reveal"
          style={{
            marginTop: 20,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 14,
            padding: '16px 20px',
            borderRadius: 'var(--nb-radius-lg, 18px)',
            background: 'var(--nb-surface-soft, #F8FAFC)',
            border: '1px solid var(--nb-border, #E2E8F0)',
          }}
        >
          <span
            className="nb-feature__icon"
            style={{ background: '#FEF3C7', color: '#B45309' }}
            aria-hidden="true"
          >
            <Clock size={18} />
          </span>
          <p style={{ margin: 0, flex: 1, minWidth: 240, fontSize: 14, color: 'var(--nb-ink-soft)' }}>
            Safety emergencies should not wait for email. Use the in-app SOS, or call local
            emergency services first.
          </p>
          <Link
            to="/legal#safety"
            className="nb-btn nb-btn--secondary"
            style={{ whiteSpace: 'nowrap' }}
          >
            <LifeBuoy size={15} aria-hidden="true" />
            Safety &amp; legal
          </Link>
        </div>
      </div>
    </section>
  );
}

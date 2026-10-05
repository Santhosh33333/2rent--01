/**
 * Site footer.
 *
 * Social links render only when a URL is actually configured. Rendering a dead
 * or invented handle would be worse than an empty column, and the brief is
 * explicit about it. Values come from Vite env vars, so they are empty until
 * the real accounts exist.
 */
import { Link } from 'react-router-dom';
import { NabriLogo } from './NabriLogo';

const SOCIAL_ENV: Array<{ label: string; key: string }> = [
  { label: 'Instagram', key: 'VITE_SOCIAL_INSTAGRAM' },
  { label: 'Facebook', key: 'VITE_SOCIAL_FACEBOOK' },
  { label: 'LinkedIn', key: 'VITE_SOCIAL_LINKEDIN' },
  { label: 'X', key: 'VITE_SOCIAL_X' },
  { label: 'YouTube', key: 'VITE_SOCIAL_YOUTUBE' },
];

const COLUMNS = [
    {
      heading: 'Nabri',
      links: [
        // Every link below resolves to a public route. The four that used to
        // point at /about, /partners, /safety and /cookies had no route at all,
        // or sat behind auth, so a logged-out visitor got a 404 or a redirect to
        // /login and the page looked missing to a store reviewer.
        { label: 'About', to: '/legal' },
        { label: 'Legal name & policies', to: '/legal' },
        { label: 'Contact', to: '/support' },
        { label: 'Support', to: '/support' },
      ],
    },
    {
      heading: 'Discover',
      links: [
        { label: 'People', to: '/discover' },
        { label: 'Events', to: '/events' },
        { label: 'Sports', to: '/sports' },
        { label: 'Movies', to: '/movies' },
        { label: 'Communities', to: '/communities' },
      ],
    },
    {
      heading: 'Safety',
      links: [
        // All public, so a reviewer can actually open them. In-app report and SOS
        // remain the primary path; these are the public equivalents.
        { label: 'Safety & legal', to: '/legal#legal-name' },
        { label: 'Privacy', to: '/privacy' },
        { label: 'Report a concern', to: '/support' },
      ],
    },
    {
      heading: 'Legal',
      links: [
        { label: 'Legal name & contacts', to: '/legal' },
        { label: 'User Agreement', to: '/terms' },
        { label: 'Privacy Policy', to: '/privacy' },
        { label: 'Safety', to: '/legal#safety' },
        { label: 'Payments & refunds', to: '/legal#payments' },
      ],
    },
  ] as const;

/**
 * Reopens the privacy preferences panel.
 *
 * A consent banner that cannot be reopened after the first visit is not a
 * consent mechanism, it is a one-time gate. Every regulation that requires
 * consent also requires it to be withdrawable, and there was previously no
 * control anywhere that did this - the event listener existed with nothing
 * dispatching it.
 */
function CookieSettingsButton() {
  return (
    <button
      type="button"
      className="nb-footer__link"
      style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}
      onClick={() => window.dispatchEvent(new CustomEvent('nabri:open-consent'))}
    >
      Cookie settings
    </button>
  );
}

export function SiteFooter() {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const social = SOCIAL_ENV.map((entry) => ({ ...entry, href: env[entry.key] })).filter(
    (entry) => typeof entry.href === 'string' && entry.href.startsWith('http')
  );

  return (
    <footer className="nb-footer">
      <div className="nb-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) repeat(4, minmax(0, 1fr))',
            gap: 32,
          }}
          data-nb-footer-grid
        >
          <div>
            <NabriLogo size={36} />
            <p className="nb-body" style={{ margin: '16px 0 0', maxWidth: '30ch', fontSize: 14 }}>
              Your Partner for Every Side of Life.
            </p>

            {social.length > 0 && (
              <ul
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 14,
                  listStyle: 'none',
                  margin: '20px 0 0',
                  padding: 0,
                }}
              >
                {social.map((entry) => (
                  <li key={entry.label}>
                    <a
                      className="nb-footer__link"
                      href={entry.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {entry.label}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h2
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--nb-ink)',
                  margin: '0 0 12px',
                }}
              >
                {column.heading}
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {column.links.map((link) => (
                  <li key={`${column.heading}-${link.label}`}>
                    <Link className="nb-footer__link" to={link.to}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <hr className="nb-divider" style={{ margin: '32px 0 20px' }} />

          {/* A store reviewer is asked to confirm the business legal name. It is
              stated in the footer bar of every public page, not only on /legal.
              Two addresses are published: the support desk for all support,
              complaint and privacy mail, and the founder as direct contact. */}
          {/* --nb-ink-soft, not --nb-ink-faint. This bar sits on --nb-bg-soft
              (#f4f2ef) rather than on the page white, and ink-faint lands at
              4.36:1 there — under the 4.5 that 13px body text needs. ink-soft
              measures 5.13:1 on the same background. */}
          <p style={{ margin: 0, fontSize: 13, color: 'var(--nb-ink-soft)' }}>
            Nabri is a technology platform. Legal name: Nabri. Support, complaints and
            privacy requests:{' '}
            <a
              href="mailto:nabri.support@gmail.com"
              className="nb-footer__link"
              style={{ textDecoration: 'underline' }}
            >
              nabri.support@gmail.com
            </a>
            . Founder contact:{' '}
            <a
              href="mailto:founder_nabri@zohomail.in"
              className="nb-footer__link"
              style={{ textDecoration: 'underline' }}
            >
              founder_nabri@zohomail.in
            </a>
            . &copy; 2026 Nabri. All rights reserved.{' '}
            <CookieSettingsButton />
          </p>
      </div>

      <style>{`
        @media (max-width: 980px) {
          [data-nb-footer-grid] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 520px) {
          [data-nb-footer-grid] { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </footer>
  );
}

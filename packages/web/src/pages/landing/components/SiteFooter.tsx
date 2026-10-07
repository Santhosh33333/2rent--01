/**
 * The site footer.
 *
 * Every route here was read out of `App.tsx`. The reference design's footer
 * linked to `#` for About, Privacy, Terms, Help and Contact, plus five social
 * icons pointing at `#` - nine links that all went nowhere. A footer is the one
 * place a visitor looks when they want to know whether a site is real, so dead
 * links there are worse than no footer at all.
 *
 * Internal routes use `<Link>` rather than `<a href>`: this is a single-page app,
 * and a plain anchor would throw away the bundle and remount the tree.
 *
 * Social channels are read from the environment and an unconfigured one is not
 * rendered, rather than rendered as a link that goes nowhere.
 */
import { Link } from 'react-router-dom';

interface Channel {
  label: string;
  key: string;
}

const CHANNELS: Channel[] = [
  { label: 'Instagram', key: 'VITE_SOCIAL_INSTAGRAM' },
  { label: 'Facebook', key: 'VITE_SOCIAL_FACEBOOK' },
  { label: 'LinkedIn', key: 'VITE_SOCIAL_LINKEDIN' },
  { label: 'X', key: 'VITE_SOCIAL_X' },
  { label: 'YouTube', key: 'VITE_SOCIAL_YOUTUBE' },
];

function readEnv(key: string): string | null {
  const value = (import.meta.env as Record<string, unknown>)[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // An unset channel, or one still holding its placeholder value, is not a link.
  if (!trimmed || /^your[-_ ]/i.test(trimmed)) return null;
  return trimmed;
}

const COLUMNS: Array<{ heading: string; links: Array<{ label: string; to?: string; href?: string }> }> = [
  {
    heading: 'Explore',
    links: [
      { label: 'Events', to: '/events' },
      { label: 'Movies', to: '/movies' },
      { label: 'Discover', to: '/discover' },
      { label: 'Communities', to: '/communities' },
      { label: 'Dating', to: '/dating' },
      { label: 'Sports', to: '/sports' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Create an account', to: '/register' },
      { label: 'Sign in', to: '/login' },
      { label: 'Reset password', to: '/forgot-password' },
      { label: 'Become a partner', to: '/partner/apply' },
      { label: 'Plans & pricing', to: '/subscription' },
      { label: 'Help centre', to: '/support' },
    ],
  },
  // Static pages, not app routes: each is a standalone form that posts to the
  // founder's mailbox. Rendered as plain anchors on purpose - a SPA link to
  // "/beta-tester.html" would route through index.html and show the landing
  // page instead of the form.
  {
    heading: 'Get involved',
    links: [
      { label: 'Become a beta tester', href: '/beta-tester.html' },
      { label: 'Share app feedback', href: '/app-feedback.html' },
      { label: 'Back Nabri', href: '/investor-supporter.html' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'User Agreement', to: '/terms' },
      { label: 'Privacy Policy', to: '/privacy' },
      { label: 'Safety', to: '/safety' },
      { label: 'Legal name & contacts', to: '/legal' },
      { label: 'Download the app', to: '/download' },
    ],
  },
];

export function SiteFooter() {
  const socials = CHANNELS.map((channel) => ({
    label: channel.label,
    href: readEnv(channel.key),
  })).filter((entry): entry is { label: string; href: string } => entry.href !== null);

  return (
    <footer className="nb-footer">
      <div className="nb-wrap">
        <div className="nb-footer-grid">
          <div>
            <Link to="/" aria-label="Nabri, back to top">
              <span className="nb-logo nb-logo--foot">
                <img src="/logo-glyph-white.svg" alt="" width={24} height={24} decoding="async" />
                <span>Nabri</span>
              </span>
            </Link>
            <p className="nb-footer-tag">
              Everything happening around you. Events, dating, communities, films and a partner
              when you need one.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <nav key={column.heading} aria-label={column.heading}>
              <h3>{column.heading}</h3>
              <ul>
                {column.links.map((link) => (
                  <li key={link.label}>
                    {link.to ? (
                      <Link to={link.to}>{link.label}</Link>
                    ) : (
                      <a href={link.href}>{link.label}</a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {socials.length > 0 ? (
          <nav aria-label="Social channels" className="nb-footer-social">
            <h3>Follow</h3>
            <ul>
              {socials.map((social) => (
                <li key={social.label}>
                  <a href={social.href} target="_blank" rel="noopener noreferrer me">
                    {social.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}

        <p className="nb-footer-copy">
          &copy; {new Date().getFullYear()} Nabri. Locations shown at neighbourhood level; exact
          addresses are never published.
        </p>
      </div>
    </footer>
  );
}
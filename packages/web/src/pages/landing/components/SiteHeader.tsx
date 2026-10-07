/**
 * The header.
 *
 * Two changes from the reference design, both forced by what actually exists:
 *
 * 1. **No fake now-playing widget.** The original header carried an animated
 *    equaliser and the track title "Good Vibes / Better Together". There is no
 *    audio catalogue in this app and no endpoint that could supply one, so it
 *    was a decorative lie in the most prominent position on the page. Gone.
 *
 * 2. **The offer button says what the offer is.** It reads the trial length
 *    from the plan the server returned rather than from a constant, so it says
 *    "Try 1 day free" today because that is what the database says - and
 *    follows an admin's change in `/admin/pricing` with no code change.
 *
 * 3. **No burger menu.** The three-line toggle is gone from the header: taps
 *    around it did not register reliably (reported on both web and app), and a
 *    menu that hides behind a button is one more thing that can fail to open.
 *    The section links now stay in the header as a horizontally swipeable row
 *    below 1000px, so the same anchors are always one tap away.
 *
 * Nav targets are section anchors on this page. Every one of those ids is set
 * by a section in `LandingPage`, so there are no dead anchors.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Brand } from './SiteChrome';
import type { Plan } from '../hooks/useLandingContent';

const LINKS = [
  { id: 'home', label: 'Home' },
  { id: 'dating', label: 'Dating' },
  { id: 'events', label: 'Events' },
  { id: 'community', label: 'Community' },
  { id: 'movies', label: 'Movies' },
] as const;

interface SiteHeaderProps {
  /** The signed-in user's first name, when there is a session. */
  userName?: string | null;
  signedIn: boolean;
  plans: Plan[];
}

export function SiteHeader({ userName, signedIn, plans }: SiteHeaderProps) {
  const [active, setActive] = useState<string>('home');

  // Highlight the section currently under the header.
  //
  // The band is deliberately narrow and offset from the top: it sits across the
  // middle of the viewport rather than the top edge, so it triggers when a
  // section is actually being read instead of when its first pixel clears the
  // 72px header.
  useEffect(() => {
    const sections = LINKS.map((link) => document.getElementById(link.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  // The trial length comes from the seeded plan, never from a constant here.
  const trialDays = plans.reduce((max, plan) => Math.max(max, plan.trialDays), 0);
  const ctaLabel = trialDays > 0 ? `Try ${trialDays} day free` : 'Get the app';

  return (
    <header className="nb-header">
      <nav className="nb-wrap nb-nav" aria-label="Primary">
        <a href="#home" aria-label="Nabri, back to top">
          <Brand size={26} />
        </a>

        <ul>
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                href={`#${link.id}`}
                data-on={active === link.id}
                aria-current={active === link.id ? 'page' : undefined}
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="nb-nav-right">
          <Link className="nb-btn nb-btn--ghost" to={signedIn ? '/home' : '/login'}>
            {signedIn ? `Hi, ${userName ?? 'there'}` : 'Sign in'}
          </Link>
          <a className="nb-btn" href="#download">
            {ctaLabel}
          </a>
        </div>
      </nav>
    </header>
  );
}
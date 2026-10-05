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
 * Nav targets are section anchors on this page. Every one of those ids is set
 * by a section in `LandingPage`, so there are no dead anchors.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
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
  const [open, setOpen] = useState(false);
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

  // Close the mobile menu on Escape. A menu that leaves the page trapped open
  // behind a full-screen header is a keyboard trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The trial length comes from the seeded plan, never from a constant here.
  const trialDays = plans.reduce((max, plan) => Math.max(max, plan.trialDays), 0);
  const ctaLabel = trialDays > 0 ? `Try ${trialDays} day free` : 'Get the app';

  return (
    <header className="nb-header">
      <nav className="nb-wrap nb-nav" aria-label="Primary">
        <a href="#home" aria-label="Nabri, back to top">
          <Brand size={26} />
        </a>

        <ul id="nb-menu" className={open ? 'is-open' : ''}>
          {LINKS.map((link) => (
            <li key={link.id}>
              <a
                href={`#${link.id}`}
                data-on={active === link.id}
                aria-current={active === link.id ? 'page' : undefined}
                onClick={() => setOpen(false)}
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
          <button
            type="button"
            className="nb-burger"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            aria-controls="nb-menu"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </nav>
    </header>
  );
}
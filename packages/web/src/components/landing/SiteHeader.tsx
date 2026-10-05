/**
 * Sticky site header.
 *
 * Shadow appears only after the page has scrolled, per the brief. The mobile
 * menu is a real dialog with a focus trap, Escape handling and a scroll lock,
 * because a fullscreen menu that leaks focus to the page behind it is a common
 * accessibility failure.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, Globe, Sun, Moon } from 'lucide-react';
import { NabriLogo } from './NabriLogo';
import { useTheme } from '../../lib/themeContext';

/**
 * Light/dark toggle for the marketing header. The landing layer is namespaced
 * under `.nb`, so Tailwind's `dark:` utilities do not apply there - the flip is
 * done by `.dark .nb` overrides in landing.css keyed off the same `.dark` class
 * this toggles on <html> (ThemeProvider). Both surfaces therefore switch at the
 * same tap, which is what makes the toggle one button instead of two.
 */
function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      className="nb-btn nb-btn--secondary"
      style={{ width: 44, padding: 0, minHeight: 44 }}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
      onClick={toggleTheme}
    >
      {dark ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}

const NAV_LINKS = [
  { label: 'Discover', to: '/discover' },
  { label: 'Events', to: '/events' },
  { label: 'Sports', to: '/sports' },
  { label: 'Movies', to: '/movies' },
  { label: 'Communities', to: '/communities' },
  { label: 'Partners', to: '/partners' },
  { label: 'Safety', to: '/safety' },
  { label: 'Support', to: '/support' },
] as const;

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Lock the page behind the open menu and restore focus on close.
  useEffect(() => {
    if (!menuOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <header className={`nb-nav${scrolled ? ' is-scrolled' : ''}`}>
      <div
        className="nb-container"
        style={{ display: 'flex', alignItems: 'center', gap: 20, minHeight: 68 }}
      >
        <Link
          to="/"
          aria-label="Nabri home"
          onClick={closeMenu}
          style={{ display: 'inline-flex', flexShrink: 0 }}
        >
          <NabriLogo size={36} />
        </Link>

        <nav aria-label="Main" className="nb-container" style={{ padding: 0, margin: '0 auto', flex: 1 }}>
          <ul
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 22,
              listStyle: 'none',
              margin: 0,
              padding: 0,
            }}
            className="nb-nav-desktop"
          >
            {NAV_LINKS.map((link) => (
              <li key={link.to}>
                <Link className="nb-nav__link" to={link.to}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div
          className="nb-nav-desktop"
          style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}
        >
          <LanguageSelector />
          <ThemeToggle />
          <Link className="nb-btn nb-btn--ghost nb-btn--sm" to="/login">
            Log in
          </Link>
          <Link className="nb-btn nb-btn--primary nb-btn--sm" to="/register">
            Create account
          </Link>
        </div>

        <div className="nb-nav-mobile" style={{ marginLeft: 'auto', display: 'none' }}>
          <button
            ref={toggleRef}
            type="button"
            className="nb-btn nb-btn--secondary"
            style={{ width: 44, padding: 0, minHeight: 44 }}
            aria-expanded={menuOpen}
            aria-controls="nb-mobile-menu"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {menuOpen && (
        <div
          id="nb-mobile-menu"
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
          className="nb-nav-mobile"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 70,
            background: 'var(--nb-bg)',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            animation: 'nb-fade-up 0.28s var(--nb-ease) both',
          }}
        >
          <div
            className="nb-container"
            style={{ display: 'flex', alignItems: 'center', gap: 16, minHeight: 68 }}
          >
            <NabriLogo size={36} />
            <button
              type="button"
              className="nb-btn nb-btn--secondary"
              style={{ width: 44, padding: 0, minHeight: 44, marginLeft: 'auto' }}
              aria-label="Close menu"
              onClick={closeMenu}
            >
              <X size={20} />
            </button>
          </div>

          <nav aria-label="Mobile" className="nb-container" style={{ paddingTop: 8, paddingBottom: 32 }}>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {NAV_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    onClick={closeMenu}
                    style={{
                      display: 'block',
                      padding: '15px 0',
                      fontSize: 19,
                      fontWeight: 650,
                      letterSpacing: '-0.02em',
                      color: 'var(--nb-ink)',
                      textDecoration: 'none',
                      borderBottom: '1px solid var(--nb-line)',
                    }}
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 24, flexWrap: 'wrap' }}>
              <LanguageSelector />
              <ThemeToggle />
              <Link className="nb-btn nb-btn--ghost" to="/login" onClick={closeMenu} style={{ flex: '1 1 auto' }}>
                Log in
              </Link>
              <Link className="nb-btn nb-btn--primary" to="/register" onClick={closeMenu} style={{ flex: '1 1 auto' }}>
                Create account
              </Link>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}

export function LanguageSelector() {
  return (
    <label
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 10px',
        minHeight: 40,
        border: '1px solid var(--nb-line)',
        borderRadius: 999,
        background: 'var(--nb-surface)',
      }}
    >
      <Globe size={16} aria-hidden="true" style={{ color: 'var(--nb-ink-faint)' }} />
      <span className="nb-sr-only">Language</span>
      <select
        defaultValue="en"
        style={{
          border: 0,
          background: 'transparent',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--nb-ink)',
          padding: '8px 2px',
          cursor: 'pointer',
        }}
      >
        {/*
          English is the only language the interface is actually translated
          into. Listing locales we cannot render would be a promise the app does
          not keep, so this stays honest until translations land.
        */}
        <option value="en">English</option>
      </select>
    </label>
  );
}

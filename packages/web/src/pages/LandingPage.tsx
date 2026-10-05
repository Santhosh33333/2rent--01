/**
 * Public marketing page.
 *
 * Sections whose backend is not publicly readable yet say so in place rather
 * than being filled with sample content — see NewHero for why the hero
 * refuses to invent event listings.
 *
 * The Events, Movies and Support sections are carried over unchanged: they are
 * wired to real endpoints and that wiring is worth more than a redesign. The
 * hero, discovery grid, feature grid, steps and closing CTA are the new build.
 *
 * The previous version of this page and the components it owned are kept
 * verbatim under src/_landing-backup/ for comparison.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SiteHeader } from '../components/landing/SiteHeader';
import { SiteFooter } from '../components/landing/SiteFooter';
import { CookieConsent } from '../components/landing/CookieConsent';
import { NewHero } from '../components/landing/NewHero';
import { MotionMarquee } from '../components/landing/MotionMarquee';
import {
  ClosingCta,
  DiscoveryGrid,
  FeatureGrid,
  HowItWorks,
} from '../components/landing/NewSections';
import { EventsSection } from '../components/landing/EventsSection';
import { MoviesSection } from '../components/landing/MoviesSection';
import { AiSection } from '../components/landing/AiSection';
import { SupportSection } from '../components/landing/SupportSection';
import { setPageMeta } from '../lib/seo';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import '../styles/landing.css';

export function LandingPage() {
  const location = useLocation();

  // Required for .nb-reveal: the CSS hides those elements until this adds
  // .is-visible, so without it the reveal sections stay invisible.
  useRevealOnScroll();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    setPageMeta({
      title: 'Nabri — Your Partner for Every Side of Life',
      description:
        'Discover people, events, sports, movies, communities and trusted partner services with Nabri.',
    });
  }, []);

  return (
    <div className="nb" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a className="nb-skip-link" href="#nb-main">
        Skip to content
      </a>

      <SiteHeader />

      <main id="nb-main" style={{ flex: 1 }}>
        <NewHero />
        <MotionMarquee />
        <DiscoveryGrid />
        <FeatureGrid />
        <HowItWorks />
        <EventsSection />
        {/* Movies sit directly after Events because a movie outing is an event
            with extra fields; splitting them would hide that. */}
        <MoviesSection />
        {/* The assistant goes directly before SupportSection: "ask a machine"
            then "talk to a human" is the intended order, and the reverse would
            read as though there is no human. */}
        <AiSection />
        <SupportSection />
        <ClosingCta />
      </main>

      <SiteFooter />
      <CookieConsent />
    </div>
  );
}
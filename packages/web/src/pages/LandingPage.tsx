/**
 * Public marketing page.
 *
 * Assembles the sections that are complete and wired to real data. Sections
 * whose backend is not publicly readable yet say so in place rather than being
 * filled with sample content.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { SiteHeader } from '../components/landing/SiteHeader';
import { SiteFooter } from '../components/landing/SiteFooter';
import { CookieConsent } from '../components/landing/CookieConsent';
import { Hero, QuickDiscovery, TrustStrip } from '../components/landing/Hero';
import { EventsSection } from '../components/landing/EventsSection';
import { MoviesSection } from '../components/landing/MoviesSection';
import { SupportSection } from '../components/landing/SupportSection';
import {
  FeaturesSection,
  AiSection,
  HowItWorksSection,
  FinalCtaSection,
} from '../components/landing/FeaturesSection';
import { setPageMeta } from '../lib/seo';
import { useRevealOnScroll } from '../hooks/useRevealOnScroll';
import '../styles/landing.css';

export function LandingPage() {
  const location = useLocation();

  // Required for .nb-reveal: the CSS hides those elements until this adds
  // .is-visible, so without it the "how it works" and CTA blocks stay invisible.
  useRevealOnScroll();

  useEffect(() => {
    // Every in-app link should land at the top rather than mid-page.
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
        <Hero />
        <TrustStrip />
        <QuickDiscovery />
        <FeaturesSection />
        <HowItWorksSection />
        <AiSection />
  <EventsSection />
  {/* Movies sit directly after Events because a movie outing is an event with
      extra fields; splitting them across the page would hide that. */}
  <MoviesSection />
  <SupportSection />
  <FinalCtaSection />
      </main>

      <SiteFooter />
      <CookieConsent />
    </div>
  );
}

/**
 * The landing page.
 *
 * Composition, in order:
 *
 *   - A fixed header over five anchored sections.
 *   - Each section carries a video backdrop that degrades to a poster and then
 *     to a pure-CSS gradient, so the page is finished with zero media loaded.
 *   - Every number, title, price and image comes from the API. Nothing here is
 *     authored content pretending to be real.
 *
 * The two hooks below are worth reading because they are the difference
 * between this page and the reference design it replaces.
 *
 * `useLandingReveal` observes with a MutationObserver. The first version
 * snapshotted the reveal targets once on mount, which meant every node an
 * async section rendered afterwards - the event rows, the posters, the category
 * chips - kept its CSS default of `opacity: 0` forever. The busiest parts of
 * the page were invisible, and because the sections that resolved fast looked
 * fine, it survived a manual pass.
 *
 * `useParallax` translates the backdrops against scroll. It is skipped entirely
 * under reduced motion, and it writes `transform` in the same property R3F's
 * old rig used to, so nothing here competes with anything else.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { setPageMeta } from '../../lib/seo';
import { SiteHeader } from './components/SiteHeader';
import { SiteFooter } from './components/SiteFooter';
import { MusicToggle } from './components/MusicToggle';
import { HeroSection } from './sections/HeroSection';
import {
  CommunitySection,
  DatingSection,
  EventsSection,
  MoviesSection,
} from './sections/PillarSections';
import {
  SportsSection,
  ActivitiesSection,
  TravelSection,
  AiDatingSection,
} from './sections/ExperienceSections';
import { DownloadSection, TrustSection } from './sections/TrustSections';
import {
  AskNabriSection,
  FaqSection,
  FutureVisionSection,
  HowItWorksSection,
} from './sections/InfoSections';
import { BetaSection, WhatIsNabriSection } from './sections/EcosystemSections';
import {
  useCommunities,
  useDiscoverProfiles,
  useEventCategories,
  useNowPlaying,
  usePlans,
  usePublicEvents,
} from './hooks/useLandingContent';
import './landing.css';

/**
 * Adds `is-in` to `.nb-rv` elements as they scroll into view.
 *
 * The CSS hides these elements until the class lands, so a missing observer
 * means invisible content rather than merely unanimated content. Three things
 * guard against that, and all three are load bearing:
 *
 *   - A MutationObserver re-scans on every DOM change, so nodes that arrive
 *     after mount are picked up.
 *   - A 1.5s failsafe reveals everything unconditionally. A backgrounded tab,
 *     a throttled rAF or an odd viewport must never leave the page blank.
 *   - The stylesheet disables the whole effect under `prefers-reduced-motion`,
 *     where `.nb-rv` is forced to `opacity: 1` regardless of the class.
 */
function useLandingReveal() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>('.nb');
    if (!root) return;

    const seen = new WeakSet<Element>();
    let observer: IntersectionObserver | null = null;

    const revealAll = (targets: Iterable<Element>) => {
      for (const el of targets) {
        seen.add(el);
        el.classList.add('is-in');
      }
    };

    const scan = () => {
      const targets = root.querySelectorAll<HTMLElement>('.nb-rv');
      if (targets.length === 0) return;

      if (typeof IntersectionObserver === 'undefined') {
        revealAll(targets);
        return;
      }

      if (!observer) {
        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (!entry.isIntersecting) continue;
              entry.target.classList.add('is-in');
              observer?.unobserve(entry.target);
            }
          },
          // A small threshold rather than a large one: a short card at the very
          // edge of the viewport should still animate in.
          { threshold: 0.08, rootMargin: '0px 0px -6% 0px' },
        );
      }

      for (const el of targets) {
        if (seen.has(el)) continue;
        seen.add(el);
        observer.observe(el);
      }
    };

    const mutations = new MutationObserver(scan);
    mutations.observe(root, { childList: true, subtree: true });

    const failsafe = window.setTimeout(() => {
      revealAll(root.querySelectorAll<HTMLElement>('.nb-rv'));
    }, 1500);

    scan();

    return () => {
      mutations.disconnect();
      observer?.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);
}

/**
 * Translates each backdrop against the scroll position.
 *
 * Reads scroll position once per frame and writes one transform per backdrop -
 * four writes, not four listeners each computing a rect. A `scale` slightly
 * above 1 hides the gap the translation opens up at the top of a section.
 */
function useParallax() {
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (window.matchMedia('(max-width: 1000px)').matches) return;

    const panels = Array.from(document.querySelectorAll<HTMLElement>('.nb-photo'));
    if (panels.length === 0) return;

    let queued = false;

    const apply = () => {
      queued = false;
      for (const panel of panels) {
        const host = panel.parentElement;
        if (!host) continue;
        const rect = host.parentElement?.getBoundingClientRect();
        if (!rect) continue;
        // Only move a section that is actually on screen.
        if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
        const offset = (rect.top * -0.08).toFixed(1);
        panel.style.transform = `translate3d(0, ${offset}px, 0) scale(1.14)`;
      }
    };

    const onScroll = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(apply);
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    apply();

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      for (const panel of panels) panel.style.transform = '';
    };
  }, []);
}

export function LandingPage() {
  const location = useLocation();
  const { user } = useAuth();
  const signedIn = Boolean(user);

  useLandingReveal();
  useParallax();

  // Five requests. All anonymous-readable, so none of them can 401.
  const events = usePublicEvents(6);
  const categories = useEventCategories();
  const movies = useNowPlaying();
  const plans = usePlans();
  const communities = useCommunities(6);
  const profiles = useDiscoverProfiles(4);

  const userName =
    (user as { fullName?: string; name?: string } | null)?.fullName?.split(' ')[0] ??
    (user as { name?: string } | null)?.name ??
    null;

  // A fresh landing visit starts at the top. Without this, going back to "/"
  // restores the previous offset and drops the visitor into the middle of a
  // section they have not read yet.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    setPageMeta({
      title: 'Nabri — Good things happen nearby',
      description:
        'Dating, events, communities and films in one place. Find what is happening around you, with verified accounts and neighbourhood-level locations.',
      image: '/logo-mark.png',
      canonicalPath: '/',
    });
  }, []);

  return (
    <div className="nb">
      <a className="nb-sr" href="#events">
        Skip to content
      </a>

      <SiteHeader userName={userName} signedIn={signedIn} plans={plans.data?.plans ?? []} />

      {/*
        Love songs as ambience, in the visitor's language. A fixed control in the
        corner rather than a bare autoplay attempt, for two reasons: every
        browser blocks audible autoplay without a gesture, and background music
        that starts on its own is hostile on a landing page. Renders nothing at
        all while the catalogue is empty, so it does not advertise a feature
        that cannot play.
      */}
      <MusicToggle variant="floating" label="background music" />

      <main id="nb-main">
        <HeroSection plans={plans.data?.plans ?? []} signedIn={signedIn} />
        <WhatIsNabriSection />
        <HowItWorksSection />
        <DatingSection profiles={profiles} signedIn={signedIn} />
        <EventsSection events={events} categories={categories} />
        <CommunitySection communities={communities} />
        <MoviesSection movies={movies} />
        <SportsSection />
        <ActivitiesSection />
        <TravelSection />
        <AiDatingSection />
        <AskNabriSection />
        <FutureVisionSection />
        <DownloadSection plans={plans} signedIn={signedIn} />
        <TrustSection />
        <BetaSection />
        <FaqSection />
      </main>

      <SiteFooter />
    </div>
  );
}

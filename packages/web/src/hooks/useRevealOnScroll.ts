/**
 * Scroll-reveal observer for the landing page.
 *
 * `landing.css` already defines `.nb-reveal` (hidden, offset 18px) and
 * `.nb-reveal.is-visible` (shown). Nothing was ever adding `is-visible`, so any
 * section using the class stayed at `opacity: 0` permanently. That is a real
 * content bug, not just missing polish: a blank block is worse than no block.
 *
 * Two safeguards, because a class that starts at `opacity: 0` is dangerous:
 *  - Elements are revealed immediately if IntersectionObserver is missing, so
 *    an old browser or a failed script never hides content.
 *  - A `no-js` / timeout fallback reveals everything after 1.2s regardless, so
 *    a scroll position that never fires the observer cannot strand the page.
 *
 * `prefers-reduced-motion` is handled in CSS; the observer still adds the class
 * so the final state is identical either way.
 */
import { useEffect } from 'react';

export function useRevealOnScroll() {
  useEffect(() => {
    // `.nb-stagger` containers are observed alongside `.nb-reveal` items:
    // the group gets `is-visible` and its CSS cascade releases the children.
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>('.nb-reveal, .nb-stagger'),
    );

    if (targets.length === 0) return;

    const revealAll = () => {
      for (const el of targets) el.classList.add('is-visible');
    };

    if (typeof IntersectionObserver === 'undefined') {
      revealAll();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      // Start the reveal slightly before the element reaches the fold, and use a
      // thin top band so a tall section does not need to be fully visible.
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
    );

    for (const el of targets) observer.observe(el);

    // Backstop: if a section sits below the fold and the observer never fires
    // (fast scroll, restored scroll position, print), show it anyway.
    const timer = window.setTimeout(revealAll, 1200);

    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
}

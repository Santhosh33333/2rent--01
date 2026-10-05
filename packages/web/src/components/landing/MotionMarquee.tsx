/**
 * Infinite ticker under the hero.
 *
 * The list is the same `DISCOVERY` array the QuickDiscovery grid renders, so
 * the ticker can never advertise a route that does not exist or drift out of
 * sync with the tiles below it.
 *
 * Accessibility: this is a link list, so it stays a list. The second copy is
 * `aria-hidden` because the loop is a visual trick — without that, a screen
 * reader user hears all twelve entries twice. Hovering or tab-focusing the
 * band pauses the scroll, which is the WCAG 2.2.2 requirement for moving
 * content that lasts more than five seconds.
 */
import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { DISCOVERY } from './discovery';

/** Custom properties are not in React's CSSProperties type, hence the cast. */
function accentStyle(accent: string): CSSProperties {
  return { '--nb-marquee-accent': accent } as CSSProperties;
}

export function MotionMarquee() {
  return (
    <div className="nb-marquee">
      {/* The track holds the list twice and is translated by exactly -50%, so
          the copy leaving the left edge is the copy entering the right. All 24
          entries must stay direct children of the track: the stylesheet hides
          items 13+ for reduced-motion users, and that only lines up if nothing
          is nested in between. */}
      <div className="nb-marquee__track">
        {DISCOVERY.map((item) => (
          <Link
            key={item.label}
            className="nb-marquee__item"
            to={item.to}
            style={accentStyle(item.accent)}
          >
            <span className="nb-marquee__dot" aria-hidden="true" />
            {item.label}
          </Link>
        ))}

        {/* Loop duplicate: aria-hidden so it is not announced twice, and not
            focusable so keyboard users do not tab through it. The stylesheet
            removes it entirely under prefers-reduced-motion. */}
        {DISCOVERY.map((item) => (
          <Link
            key={`dup-${item.label}`}
            className="nb-marquee__item"
            to={item.to}
            tabIndex={-1}
            aria-hidden="true"
            style={accentStyle(item.accent)}
          >
            <span className="nb-marquee__dot" />
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
/**
 * 3D interaction primitives for the landing page.
 *
 * Three separate concerns, deliberately kept apart so a card can use any
 * combination of them:
 *
 *   useTilt3D  pointer-tracked rotation that follows the cursor in 3D
 *   TiltCard   a link that tilts toward the pointer and presses in 3D on click
 *   FlipCard   a self-contained card that flips in 3D when activated
 *
 * Two rules the whole file obeys:
 *
 * 1. Nothing animates a property other than `transform` / `opacity`. Layout,
 *    paint and compositing stay out of it, so a page full of tilting cards
 *    still scrolls at 60fps.
 *
 * 2. Nothing moves for someone who asked it not to. Every effect checks
 *    `prefers-reduced-motion` and bails, and the tilt additionally bails on
 *    coarse pointers — a touch device has no hover state, so the listeners
 *    would fire on every scroll tick for an effect nobody can see.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';

/** True when the visitor has asked the OS for less motion. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** True only for a real hovering pointer (mouse/trackpad), not a finger. */
function hasFineHover(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
  );
}

/* ------------------------------------------------------------------ tilt */

/**
 * Tracks the pointer over an element and writes the rotation it implies into
 * `--nb-rx` / `--nb-ry`. The transform itself lives in CSS, so the browser can
 * interpolate between the values we write and there is no per-frame React
 * render.
 *
 * Writes are coalesced into one animation frame, and the bounding box is
 * measured once on enter rather than on every move — `getBoundingClientRect`
 * on every pointermove is the classic way to make a "cheap" effect expensive.
 */
export function useTilt3D<T extends HTMLElement>(max = 9) {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || !hasFineHover()) return;

    let frame = 0;
    let box: DOMRect | null = null;

    const write = (rx: number, ry: number) => {
      el.style.setProperty('--nb-rx', `${rx.toFixed(2)}deg`);
      el.style.setProperty('--nb-ry', `${ry.toFixed(2)}deg`);
      // Drives the specular sheen, which follows the pointer rather than
      // sitting at a fixed angle like a plain CSS gradient would.
      el.style.setProperty('--nb-px', `${(50 + ry * 4).toFixed(1)}%`);
      el.style.setProperty('--nb-py', `${(50 + rx * 4).toFixed(1)}%`);
    };

    const flush = () => {
      frame = 0;
      const rect = box ?? el.getBoundingClientRect();
      // Pointer position as 0..1 across the element.
      const px = (lastX - rect.left) / (rect.width || 1);
      const py = (lastY - rect.top) / (rect.height || 1);
      // Inverted: pushing the cursor up should tip the top of the card away.
      write((0.5 - py) * max * 2, (px - 0.5) * max * 2);
    };

    let lastX = 0;
    let lastY = 0;

    const onEnter = () => {
      box = el.getBoundingClientRect();
    };

    const onMove = (event: PointerEvent) => {
      lastX = event.clientX;
      lastY = event.clientY;
      if (frame) return;
      frame = window.requestAnimationFrame(flush);
    };

    const onLeave = () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
        frame = 0;
      }
      box = null;
      write(0, 0);
    };

    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [max]);

  return ref;
}

/* ------------------------------------------------------------- tilt card */

/**
 * A link that tips toward the pointer in 3D and presses in 3D on click.
 *
 * The press is pure CSS on `:active` — the click still navigates immediately,
 * so there is no artificial delay and no `preventDefault`. That matters: a
 * "flip then navigate" pattern has to either stall the navigation or leak a
 * suppressed click, and both are worse than the effect is worth.
 */
export function TiltCard({
  to,
  children,
  className = '',
  max = 9,
  style,
}: {
  to: string;
  children: ReactNode;
  className?: string;
  max?: number;
  style?: CSSProperties;
}) {
  const ref = useTilt3D<HTMLAnchorElement>(max);

  // Keyboard users get the tilt snapped to centre rather than left at whatever
  // the pointer last set, so focusing a card is visually meaningful.
  const reset = useCallback(() => {
    ref.current?.style.setProperty('--nb-rx', '0deg');
    ref.current?.style.setProperty('--nb-ry', '0deg');
  }, [ref]);

  return (
    <Link
      ref={ref}
      to={to}
      className={`nb-tilt-card ${className}`.trim()}
      style={style}
      onBlur={reset}
    >
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------- flip card */

/**
 * A card that turns over in 3D when it is activated.
 *
 * The card IS the button, and neither face contains another interactive
 * element — the back face is prose. Nesting a link inside a button is invalid
 * HTML and breaks both keyboard and screen-reader operation, and the obvious
 * alternative (a separate flip button plus a separate CTA) turns one card into
 * two tab stops for no gain. Escape flips it back, which is the convention for
 * a disclosure and costs one key handler.
 */
export function FlipCard({
  front,
  back,
  flipLabel,
  className = '',
}: {
  front: ReactNode;
  back: ReactNode;
  flipLabel: string;
  className?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const panelId = useId();

  return (
    <div className={`nb-flip ${flipped ? 'is-flipped' : ''} ${className}`.trim()}>
      <button
        type="button"
        className="nb-flip__inner"
        /* An explicit name, because the button's content is both faces of the
           card: without it the accessible name would be the front text and the
           back text concatenated into one sentence. */
        aria-label={flipLabel}
        aria-expanded={flipped}
        aria-controls={panelId}
        onClick={() => setFlipped((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && flipped) {
            event.stopPropagation();
            setFlipped(false);
          }
        }}
      >
        {/* Whichever face is turned away is hidden from assistive tech, so the
            card never reads out its back text while showing its front. */}
        <span
          className="nb-flip__face nb-flip__face--front"
          aria-hidden={flipped || undefined}
        >
          {front}
        </span>
        <span
          className="nb-flip__face nb-flip__face--back"
          id={panelId}
          aria-hidden={flipped ? undefined : true}
        >
          {back}
          <span className="nb-flip__hint">Press again or Esc to turn back</span>
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ count up */

/**
 * Counts to `value` once the element scrolls into view.
 *
 * Cosmetic, so it does nothing for reduced-motion visitors — they get the final
 * number immediately rather than being shown a value that is briefly wrong.
 * Driven by an IntersectionObserver instead of a timer so off-screen sections
 * never animate at all.
 */
export function CountUp({
  value,
  suffix = '',
  duration = 1400,
}: {
  value: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));

  // `shown` is deliberately NOT an effect dependency. It changes on every
  // animation frame, and an effect that depended on it would tear down and
  // recreate itself each frame — cancelling the very rAF that is driving the
  // count, so the number would restart from zero forever and never arrive.
  //
  // Recreating the observer is harmless (disconnect is idempotent), which
  // matters because StrictMode mounts, unmounts and remounts every effect in
  // development. An earlier version guarded this with a ref to avoid
  // double-observing; that guard instead swallowed the remount, so no observer
  // survived and the count stayed at 0.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }

    let frame = 0;
    let observer: IntersectionObserver | null = null;

    const run = () => {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // Ease-out cubic: fast first, settling gently on the final number.
        const eased = 1 - Math.pow(1 - t, 3);
        setShown(Math.round(value * eased));
        if (t < 1) frame = window.requestAnimationFrame(tick);
      };
      frame = window.requestAnimationFrame(tick);
    };

    observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer?.disconnect();
        run();
      },
      { threshold: 0.4 },
    );
    observer.observe(el);

    return () => {
      observer?.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [value, duration]);

  return (
    <span ref={ref}>
      {shown.toLocaleString('en-IN')}
      {suffix}
    </span>
  );
}

/** Pointer event re-exported for consumers that need the React type. */
export type CardPointerEvent = ReactPointerEvent<HTMLElement>;
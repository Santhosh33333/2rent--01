/**
 * Cinematic motion backdrop for the hero.
 *
 * The brief was "a moving landing page". A video file is the obvious way to
 * ship that and the wrong one here: a hero clip is several megabytes on the
 * critical path, it autoplays unmuted-by-default on some mobile browsers, it
 * goes stale the moment the brand changes, and it cannot respond to the theme
 * or the accent the visitor picked.
 *
 * So the shipped experience is procedural - four blurred colour blobs on
 * coprime drift cycles, a slow conic sweep and a fixed grain tile. It is
 * transform/opacity only, so it composites on the GPU and never triggers
 * layout, and it is a few kilobytes of CSS rather than a few megabytes of
 * video.
 *
 * If a real clip is wanted later, drop an H.264 + WebM loop in
 * `public/landing/` and point HERO_VIDEO_SRC at it. It renders underneath this
 * mesh, so it layers in without any other change. It is null by default
 * precisely so that the default build never issues a request for a file that
 * is not there.
 */
import { useEffect, useRef } from 'react';

/**
 * Optional hero video. Must be a silent, short, seamless loop - anything with
 * audio, a hard cut or visible letterboxing will fight the mesh above it.
 */
const HERO_VIDEO_SRC: string | null = null;

export function HeroMotion() {
  const layerRef = useRef<HTMLDivElement>(null);

  // Parallax. The backdrop drifts against the page as the visitor scrolls, so
  // the hero has depth rather than being a flat picture behind the copy.
  //
  // rAF-throttled and passive, and it writes a single custom property that
  // only ever feeds a transform. Reduced-motion users are skipped entirely -
  // they get the mesh frozen in place, which is a still image, not a broken
  // animation.
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;

    const apply = () => {
      frame = 0;
      const rect = layer.getBoundingClientRect();
      // Normalised to roughly -1..1 across the viewport, then scaled down to
      // 46px. Tracking scroll one-to-one would look like the layer is sliding
      // out from under the page; this is the small, slow lag that reads as depth.
      const progress = Math.min(1, Math.max(-1, (window.innerHeight - rect.top) / window.innerHeight - 1));
      layer.style.setProperty('--nb-motion-y', `${(progress * 46).toFixed(1)}px`);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return (
    <div className="nb-hero__motion" ref={layerRef} aria-hidden="true">
      {HERO_VIDEO_SRC ? (
        <video
          className="nb-motion-video"
          src={HERO_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          tabIndex={-1}
        />
      ) : null}

      <div className="nb-motion-mesh">
        <span className="nb-motion-blob nb-motion-blob--a" />
        <span className="nb-motion-blob nb-motion-blob--b" />
        <span className="nb-motion-blob nb-motion-blob--c" />
        <span className="nb-motion-blob nb-motion-blob--d" />
      </div>

      <div className="nb-motion-beam" />
      <div className="nb-motion-grain" />
    </div>
  );
}
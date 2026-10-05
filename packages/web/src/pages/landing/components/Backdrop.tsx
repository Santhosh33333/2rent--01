/**
 * The section backdrop.
 *
 * Three layers, always in this order:
 *
 *   1. a CSS gradient  - zero bytes, always renders
 *   2. a still poster  - ~40-110 KB JPEG, shows before any video decodes
 *   3. the video       - loaded only when the section is on screen
 *
 * The gradient is not decoration. It is what the section looks like if the
 * visitor is on a slow connection, if the browser refuses H.264, or if the
 * file is simply missing - and because it is a real `<div>`, the layout never
 * depends on the media arriving.
 *
 * ## Why there is an `onError` handler
 *
 * A missing video is the case this gets wrong by default. The dev server and a
 * production SPA host both answer an unknown `/video/*.mp4` with `index.html`
 * and a `200`, so the `<video>` element receives HTML rather than a decode
 * error and never fires `error` at all - it just sits there at
 * `readyState === 0` forever, holding a poster that is fine and a decoder that
 * is not.
 *
 * So the handler checks `videoWidth` on `loadedmetadata` as well as listening
 * for `error`, and on either failure swaps the still poster into a real `<img>`.
 * The section then looks exactly as designed, minus the motion, and no dead
 * decoder is left running.
 */
import { useEffect, useRef, useState } from 'react';

export type SceneKind = 'hero' | 'dating' | 'events' | 'community' | 'movies' | 'cta';

interface BackdropProps {
  scene: SceneKind;
  /** Footage name under `public/video/`, without the `nabri-` prefix. */
  name?: string;
  /** Gradient only - used by the CTA, which has no footage. */
  gradientOnly?: boolean;
}

export function Backdrop({ scene, name, gradientOnly = false }: BackdropProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  const poster = name && !gradientOnly ? `/video/poster-${name}.jpg` : null;
  const src = name && !gradientOnly ? `/video/nabri-${name}.mp4` : null;

  useEffect(() => {
    setFailed(false);
  }, [src]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Reduced motion is honoured by not starting playback at all. The poster
    // underneath stays, so the section still has its image.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.removeAttribute('autoplay');
      return;
    }

    // Autoplay can still be refused - a browser may have a per-origin
    // autoplay block, or the element may be hidden. This catch is load
    // bearing: an unhandled rejection here surfaces as a console error on
    // every section the visitor scrolls past.
    video.play().catch(() => {
      // Nothing to do. The poster is showing and it looks fine.
    });
  }, [failed]);

  const giveUp = () => {
    // `videoWidth === 0` with a nominally valid element means the browser was
    // handed something that is not a video.
    setFailed(true);
  };

  return (
    <div className="nb-media" aria-hidden="true">
      <div className={`nb-scene nb-scene--${scene}`} />
      {poster ? (
        <div className={`nb-photo${scene === 'hero' ? ' nb-photo--hero' : ''}`}>
          {src && !failed ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              poster={poster}
              onError={giveUp}
              onLoadedMetadata={(event) => {
                if (event.currentTarget.videoWidth === 0) giveUp();
              }}
            >
              <source src={src} type="video/mp4" />
            </video>
          ) : (
            <img src={poster} alt="" loading="lazy" decoding="async" />
          )}
        </div>
      ) : null}
    </div>
  );
}
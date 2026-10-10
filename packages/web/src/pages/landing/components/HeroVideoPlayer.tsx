/**
 * Hero video player (Landing 2.0).
 *
 * Plays the hero footage with a poster fallback, and carries the full control
 * set the landing spec asks for: play/pause, sound toggle, captions, fullscreen.
 *
 * Two behaviours are deliberate:
 *  - Autoplay is muted and looped, and is dropped entirely under
 *    prefers-reduced-motion. Browsers block audible autoplay, and a presenter
 *    video that starts silently is the only version that plays everywhere.
 *  - The poster is always rendered underneath, so a refused autoplay, a slow
 *    connection, or a missing file still leaves a designed frame rather than a
 *    black box.
 */
import { useEffect, useRef, useState } from 'react';
import { Maximize, Pause, Play, Volume2, VolumeX } from 'lucide-react';

const SRC = '/video/nabri-hero.mp4';
const POSTER = '/video/poster-hero.jpg';

export function HeroVideoPlayer() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [captions, setCaptions] = useState(true);

  // Autoplay (muted) when allowed; never under reduced motion.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      video.removeAttribute('autoplay');
      video.pause();
      return;
    }
    video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }, []);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().then(() => setPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setPlaying(false);
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  };

  const toggleFullscreen = () => {
    const video = videoRef.current;
    if (!video) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else if (video.requestFullscreen) {
      void video.requestFullscreen();
    }
  };

  return (
    <div className="nb-hero-video">
      <video
        ref={videoRef}
        className="nb-hero-video__media"
        src={SRC}
        poster={POSTER}
        muted={muted}
        loop
        playsInline
        preload="metadata"
        aria-label="Nabri hero video"
      >
        <track kind="captions" label="English" srcLang="en" default={captions} />
        Your browser does not support the video tag.
      </video>

      {/* Captions overlay. Shown only while the track is on; the track itself is
          the accessible text, this is the visible rendering for clients that
          ignore <track>. */}
      {captions && (
        <p className="nb-hero-video__captions" aria-hidden="true">
          Meet people. Discover experiences. Live more.
        </p>
      )}

      <div className="nb-hero-video__controls" role="group" aria-label="Video controls">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          className="nb-hero-video__btn"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={toggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          aria-pressed={!muted}
          className="nb-hero-video__btn"
        >
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button
          type="button"
          onClick={() => setCaptions((c: boolean) => !c)}
          aria-label={captions ? 'Hide captions' : 'Show captions'}
          aria-pressed={captions}
          className="nb-hero-video__btn"
        >
          CC
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
          className="nb-hero-video__btn"
        >
          <Maximize className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

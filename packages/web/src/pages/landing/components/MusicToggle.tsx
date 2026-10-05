/**
 * The music control.
 *
 * One component for every surface, in two sizes. It is deliberately the only
 * place in the app that knows how to start audio, which is what keeps the
 * autoplay gesture rule enforceable: a toggle is always a button, so the click
 * that starts a track is always a real user gesture.
 *
 * When there is no catalogue - which is the state this repository ships in - it
 * renders nothing at all. An inert music button on a landing page is worse than
 * no button: it advertises a feature that cannot work.
 */
import { useState } from 'react';
import { Music2, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { useSongPlayer } from '../../../lib/songPlayer';

interface MusicToggleProps {
  /** `floating` sits over a page; `inline` sits in a row of other controls. */
  variant?: 'floating' | 'inline';
  className?: string;
  /** Accessible name context, e.g. "background music". */
  label?: string;
}

export function MusicToggle({ variant = 'inline', className = '', label = 'music' }: MusicToggleProps) {
  const player = useSongPlayer();
  const [showNote, setShowNote] = useState(false);

  // Nothing to play. Say nothing rather than advertising an empty feature.
  if (!player.available || player.mutedByUser) return null;

  const onClick = () => {
    player.toggle();
    // If the browser refused, the tap that unblocks it is the next one, so say so
    // once rather than leaving a control that looks broken.
    if (player.blocked) setShowNote(true);
  };

  const cls = `nb-music ${variant === 'floating' ? 'nb-music--floating' : 'nb-music--inline'} ${className}`.trim();

  return (
    <div className={cls}>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={player.playing}
        aria-label={player.playing ? `Pause ${label}` : `Play ${label}`}
        className="nb-music-btn"
      >
        {player.playing ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
        <span className="nb-music-label">
          {player.current?.title ?? (player.playing ? 'Playing' : 'Play music')}
        </span>
      </button>

      {player.current && (
        <button
          type="button"
          onClick={player.next}
          aria-label="Next track"
          className="nb-music-btn nb-music-btn--icon"
        >
          <SkipForward aria-hidden="true" />
        </button>
      )}

      {/*
        The autoplay notice. Browsers refuse audible playback without a gesture,
        and a control that does nothing on first tap is the most confusing way to
        discover that. This names it and asks for one more tap.
      */}
      {player.blocked && (
        <p className="nb-music-note" role="status">
          Your browser blocked autoplay. Tap play once more to start {label}.
        </p>
      )}

      {/* Tailwind's sr-only rather than the landing sheet's .nb-sr: this control
          also renders outside the landing page, where that helper is not loaded. */}
      {showNote && !player.blocked && <span className="sr-only" aria-live="polite" />}
    </div>
  );
}

/**
 * A one-shot player for a moment that should have a sound.
 *
 * Used on a dating match. It is a button rather than an effect that fires on
 * mount, for the same reason: a match arriving must not be able to start audio
 * on its own, because the visitor has not asked for anything yet.
 */
export function MatchSongPrompt() {
  const player = useSongPlayer();
  if (!player.available) return null;

  return (
    <button
      type="button"
      onClick={player.play}
      className="nb-match-song"
      aria-label="Play a love song for this match"
    >
      <Music2 aria-hidden="true" />
      <span>
        {player.playing && player.current
          ? `Now playing: ${player.current.title}`
          : 'Play a love song'}
      </span>
    </button>
  );
}

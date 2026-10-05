/**
 * The music page.
 *
 * A dedicated home for the song player, for members who want the music rather
 * than the ambient toggle they get everywhere else. Same player, same rules -
 * this page does not own an audio element, it only drives the shared one.
 *
 * Two things this page refuses to do:
 *
 *   - Invent content. With no catalogue it says so plainly and stops. A list of
 *     plausible Tamil love-song titles that cannot play is worse than an empty
 *     page, because it is a lie the visitor has to discover for themselves.
 *   - Offer a language with nothing in it. The picker is built from
 *     `availableLanguages`, so every option is one that can actually produce
 *     sound. Offering "English" against a Tamil-only catalogue would be a dead
 *     end offered as a feature.
 *
 * The empty states are distinguished on purpose. "No music has been added yet"
 * and "nothing in Tamil" are different facts with different fixes - one needs
 * audio files, the other needs a language switch - and collapsing them into a
 * single "no songs" would hide which one it is.
 */
import { useState } from 'react'
import { Headphones, Info, Music4, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { useSongPlayer } from '../../lib/songPlayer'
import { YouTubePlaylistPlayer } from './YouTubePlaylistPlayer'
import type { SongTrack } from '../../lib/songLibrary'

/**
 * Display names for the languages the product ships music in.
 *
 * Only shown for languages that actually have tracks, so this table is a label
 * lookup rather than the source of the picker contents. A language not listed
 * here falls back to its own code, which is still honest.
 */
const LANGUAGE_NAMES: Record<string, string> = {
  ta: 'Tamil',
  en: 'English',
  hi: 'Hindi',
  te: 'Telugu',
  ml: 'Malayalam',
  kn: 'Kannada',
  mr: 'Marathi',
  bn: 'Bengali',
  gu: 'Gujarati',
  pa: 'Punjabi',
  es: 'Spanish',
  fr: 'French',
  de: 'German',
}

function languageName(code: string): string {
  return LANGUAGE_NAMES[code] ?? code
}

/** The honest explanation for a page with no playable tracks. */
function emptyCopy(reason: ReturnType<typeof useSongPlayer>['emptyReason']) {
  switch (reason) {
    case 'loading':
      return {
        title: 'Loading the catalogue',
        description: 'One moment.',
      }
    case 'no-language-match':
      return {
        title: 'Nothing in this language yet',
        description:
          'Songs exist, but none are in this language. Pick another language above, or add tracks for this one.',
      }
    case 'muted':
      return {
        title: 'Music is switched off',
        description: 'Turn it back on to see what is here.',
      }
    default:
      // Scoped to the ambient player on purpose. This section can be empty
      // while the page below it is full of playable YouTube playlists, so
      // saying only "no music added yet" would read as the whole page being
      // dead. It names what is missing and points at what does work.
      return {
        title: 'No ambient audio files yet',
        description:
          'Instrumental love songs for the background player will appear here once audio files are added and licensed. Nothing is listed until it can actually play. The YouTube playlists below do play today.',
      }
  }
}

export function MusicPage() {
  const player = useSongPlayer()
  const [notice, setNotice] = useState<string | null>(null)

  const { emptyReason } = player
  const copy = emptyCopy(emptyReason)
  const hasTracks = player.tracks.length > 0

  // Every control is a button, never an effect, so the tap that starts audio is
  // always a real gesture. See the autoplay note in lib/songPlayer.tsx.
  const start = (fn: () => void) => {
    fn()
    setNotice(player.blocked ? 'blocked' : null)
  }

  const languages = player.availableLanguages

  return (
    <div className="space-y-6">
      <PageHeader
        title="Music"
        subtitle="Instrumental love songs. Tamil first, with a language picker for the rest."
      />

      <AnimatedPage delay={50}>
        {/* Now playing. Absent entirely when there is nothing to play, rather
            than a disabled transport control that looks broken. */}
        {hasTracks && (
          <div className="glass-card p-5">
            <div className="flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-surface-500">
                  {player.playing ? 'Now playing' : player.current ? 'Paused' : 'Ready'}
                </p>
                <p className="mt-1 font-semibold truncate">
                  {player.current?.title ?? 'Nothing loaded'}
                </p>
                {player.current?.artist && (
                  <p className="text-sm text-surface-500 truncate">{player.current.artist}</p>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => start(player.current ? player.toggle : player.play)}
                  aria-label={player.playing ? 'Pause' : 'Play'}
                  className="w-12 h-12 rounded-2xl bg-primary-600 text-white flex items-center justify-center shadow-lg shadow-primary-500/25 hover:bg-primary-700 transition-colors"
                >
                  {player.playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                </button>
                <button
                  type="button"
                  onClick={() => start(player.next)}
                  aria-label="Skip to next song"
                  className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                  <SkipForward className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => player.setMutedByUser(!player.mutedByUser)}
                  aria-pressed={player.mutedByUser}
                  aria-label={player.mutedByUser ? 'Turn music on' : 'Turn music off'}
                  className="w-12 h-12 rounded-2xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-300 flex items-center justify-center hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                >
                  {player.mutedByUser ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/*
              The browser blocked audible playback. Named rather than swallowed:
              a play button that does nothing on the first tap is the most
              confusing way to hit an autoplay policy.
            */}
            {player.blocked && notice === 'blocked' && (
              <p role="status" className="mt-4 text-sm text-amber-700 dark:text-amber-400 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Your browser blocked autoplay. Tap play once more and the music will start.
                </span>
              </p>
            )}

            {player.mutedByUser && (
              <p className="mt-4 text-sm text-surface-500">
                Music is switched off for this device. Nothing will play until you switch it back on.
              </p>
            )}
          </div>
        )}
      </AnimatedPage>

      {/* The language picker. Only languages that have love songs appear, so
          every option is one that can produce sound. */}
      {languages.length > 1 && (
        <AnimatedPage delay={100}>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {languages.map((code) => {
              const active = code === player.language
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => player.setLanguage(code)}
                  aria-pressed={active}
                  className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                    active
                      ? 'bg-rose-600 text-white shadow-lg shadow-rose-500/25'
                      : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                  }`}
                >
                  {languageName(code)}
                </button>
              )
            })}
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={150}>
        {player.loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-16 rounded-2xl" />
            ))}
          </div>
        ) : hasTracks ? (
          <ul className="space-y-2">
            {player.tracks.map((track: SongTrack) => {
              const active = player.current?.id === track.id
              return (
                <li key={track.id}>
                  <button
                    type="button"
                    onClick={() => start(() => player.playTrack(track))}
                    aria-current={active ? 'true' : undefined}
                    className={`w-full flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors ${
                      active
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/40'
                        : 'border-surface-200 dark:border-surface-800 hover:border-primary-300'
                    }`}
                  >
                    <span className="w-10 h-10 shrink-0 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center">
                      {active && player.playing ? (
                        <Volume2 className="w-4 h-4 text-primary-600 dark:text-primary-400" />
                      ) : (
                        <Music4 className="w-4 h-4 text-surface-400" />
                      )}
                    </span>

                    <span className="flex-1 min-w-0">
                      <span className="block font-semibold text-sm truncate">{track.title}</span>
                      {track.artist && (
                        <span className="block text-xs text-surface-500 truncate">{track.artist}</span>
                      )}
                    </span>

                    {/*
                      Credits are part of the licence, not decoration. A licence
                      that requires attribution and a row that hides it is not a
                      licence-compliant player.
                    */}
                    {(track.credit || track.license) && (
                      <span className="shrink-0 text-xs text-surface-500 text-right max-w-[40%] truncate">
                        {[track.credit, track.license].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState
            icon={Headphones}
            title={copy.title}
            description={copy.description}
            action={
              emptyReason === 'muted' ? (
                <button
                  type="button"
                  onClick={() => player.setMutedByUser(false)}
                  className="text-sm font-semibold text-primary-600 dark:text-primary-400"
                >
                  Turn music back on
                </button>
              ) : undefined
            }
          />
        )}
      </AnimatedPage>

      {/*
        YouTube, after the local catalogue rather than instead of it. The empty
        state above is honest about having no audio files; this is the part of
        the page that can still make sound today, so it follows rather than
        competes with the local player. See lib/youtubePlaylist.ts for why these
        are a visible player and never ambient audio.
      */}
      <AnimatedPage delay={200}>
        <YouTubePlaylistPlayer />
      </AnimatedPage>
    </div>
  )
}
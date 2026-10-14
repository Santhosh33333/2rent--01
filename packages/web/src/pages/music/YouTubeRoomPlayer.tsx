/**
 * A room's YouTube video, played through YouTube's own player and driven by
 * the host.
 *
 * WHY A REAL PLAYER
 * -----------------
 * A bare `<iframe>` can only play what a viewer clicks, which is useless for a
 * room: there is no way to make the host's play/pause/seek happen on everyone
 * else's screen. So the embed is created through YouTube's IFrame Player API,
 * which exposes `playVideo` / `pauseVideo` / `seekTo` and reports the playhead
 * back.
 *
 * VISIBILITY, AND WHY THE CONTROLS DIFFER PER ROLE
 * ------------------------------------------------
 * The video is always a visible, uncovered frame — YouTube's terms forbid
 * hidden, overlaid or audio-only playback, and a blocked player would leave the
 * room broken rather than merely non-compliant.
 *
 *   - The **host** keeps YouTube's own control bar, because that is how they
 *     choose and move within the video.
 *   - **Guests** get `controls=0`. Their transport is the room's: letting a
 *     guest scrub their own frame would desync them from the host, which is the
 *     one thing this feature cannot tolerate. A guest still gets one tap to
 *     start (browsers refuse to start unmuted media on their own), after which
 *     their frame follows the host.
 *
 * SYNC MODEL
 * ----------
 * Identical to the audio path: the host is the clock, guests re-derive their
 * target as `positionSec + elapsed since updatedAt`. The host's progress is
 * reported as a heartbeat, so a guest drifting after buffering is pulled back
 * within a few seconds.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import { ExternalLink } from 'lucide-react'
import { loadYouTubeIframeApi } from '../../lib/youtubePlayer'

export interface RoomSyncState {
  positionSec: number
  updatedAt: string
  isPlaying: boolean
}

/** Imperative handle the page uses for the guest's "Sync now" gesture. */
export interface YouTubeTransport {
  /** Re-apply the host's playhead and play state immediately. */
  applyNow(): void
}

interface Props {
  videoId: string
  isHost: boolean
  sync: RoomSyncState | null
  transportRef: MutableRefObject<YouTubeTransport | null>
  /** Host → room. Only ever called on the host, never on a guest. */
  onControl: (action: 'play' | 'pause', positionSec: number) => void
  /** Host → room, every few seconds, so guests can correct drift. */
  onHeartbeat: (positionSec: number, isPlaying: boolean) => void
  /** For the page's own now-playing line and progress readout. */
  onProgress: (positionSec: number, duration: number, isPlaying: boolean) => void
  /** The guest's auto-start was refused; ask them for one gesture. */
  onRequestTap: () => void
}

/** Seconds the target and the frame may differ before a seek is worth sending. */
const SEEK_TOLERANCE = 1.5
/** How often the host reports its playhead to the rest of the room. */
const HEARTBEAT_MS = 4000

const YT_STATE_UNSTARTED = -1
const YT_STATE_ENDED = 0
const YT_STATE_PLAYING = 1
const YT_STATE_PAUSED = 2
const YT_STATE_CUED = 5

export function YouTubeRoomPlayer({
  videoId,
  isHost,
  sync,
  transportRef,
  onControl,
  onHeartbeat,
  onProgress,
  onRequestTap,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<any>(null)
  const readyRef = useRef(false)
  const startedRef = useRef(false)
  const lastStateRef = useRef(YT_STATE_UNSTARTED)
  const [failed, setFailed] = useState(false)

  // Live sync, read from inside callbacks the player captured once.
  const syncRef = useRef<RoomSyncState | null>(sync)
  syncRef.current = sync

  const handlersRef = useRef({ onControl, onHeartbeat, onProgress, onRequestTap, isHost })
  handlersRef.current = { onControl, onHeartbeat, onProgress, onRequestTap, isHost }

  /** Where the host's clock says this frame should be, right now. */
  const targetPosition = useCallback((): number | null => {
    const s = syncRef.current
    if (!s) return null
    const elapsed = s.isPlaying
      ? Math.max(0, (Date.now() - new Date(s.updatedAt).getTime()) / 1000)
      : 0
    return s.positionSec + elapsed
  }, [])

  const applyNow = useCallback(() => {
    const player = playerRef.current
    const desired = syncRef.current
    if (!player || !desired) return

    try {
      const target = targetPosition()
      const current = player.getCurrentTime()
      if (
        target !== null &&
        Number.isFinite(target) &&
        Number.isFinite(current) &&
        Math.abs(current - target) > SEEK_TOLERANCE
      ) {
        player.seekTo(target, true)
      }
    } catch {
      /* frame not ready; the next sync retries */
    }

    try {
      if (desired.isPlaying) player.playVideo()
      else player.pauseVideo()
    } catch {
      /* the guest's gesture is still needed — onRequestTap covers it */
    }
  }, [targetPosition])

  useEffect(() => {
    transportRef.current = { applyNow }
    return () => {
      transportRef.current = null
    }
  }, [applyNow, transportRef])

  // --- Build and tear down the player whenever the video or the role changes ---
  useEffect(() => {
    const mount = hostRef.current
    if (!mount) return

    let cancelled = false
    let player: any = null
    setFailed(false)

    const target = document.createElement('div')
    target.style.width = '100%'
    target.style.height = '100%'
    mount.appendChild(target)

    const read = () => {
      try {
        return player?.getCurrentTime() ?? 0
      } catch {
        return 0
      }
    }

    loadYouTubeIframeApi()
      .then((api) => {
        if (cancelled) return
        const YT = api as { Player: new (el: HTMLElement, options: unknown) => any }
        player = new YT.Player(target, {
          videoId,
          width: '100%',
          height: '100%',
          playerVars: {
            // The host operates the video; guests follow the room instead of
            // getting a control bar that would let them desync themselves.
            controls: isHost ? 1 : 0,
            playsinline: 1,
            rel: 0,
            modestbranding: 1,
            iv_load_policy: 3,
            enablejsapi: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: () => {
              if (cancelled) return
              readyRef.current = true
              const h = handlersRef.current
              try {
                const duration = player.getDuration?.() ?? 0
                h.onProgress(read(), duration, false)
              } catch {
                /* not queryable yet */
              }
              // A guest lands on the host's playhead straight away.
              if (!handlersRef.current.isHost) applyNow()
            },
            onStateChange: (event: { data: number }) => {
              if (cancelled) return
              const state = event.data
              const was = lastStateRef.current
              const h = handlersRef.current

              try {
                h.onProgress(read(), player.getDuration?.() ?? 0, state === YT_STATE_PLAYING)
              } catch {
                /* ignore */
              }

              if (h.isHost) {
                // The host is authoritative, but only for a *real* transition:
                // arriving on a paused frame must not broadcast a pause that
                // would bump the room's version on every page load.
                if (state === YT_STATE_PLAYING && was !== YT_STATE_PLAYING) {
                  h.onControl('play', read())
                  startedRef.current = true
                } else if (
                  (state === YT_STATE_PAUSED || state === YT_STATE_ENDED) &&
                  was === YT_STATE_PLAYING
                ) {
                  h.onControl('pause', read())
                }
              } else if (
                (state === YT_STATE_PAUSED || state === YT_STATE_CUED) &&
                syncRef.current?.isPlaying
              ) {
                // The room is playing but this frame is not: autoplay was
                // refused. Say so instead of leaving the room silent.
                h.onRequestTap()
              }

              lastStateRef.current = state
            },
            onError: () => {
              if (!cancelled) setFailed(true)
            },
          },
        })
        playerRef.current = player
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      readyRef.current = false
      try {
        player?.destroy()
      } catch {
        /* already gone */
      }
      if (playerRef.current === player) playerRef.current = null
      mount.innerHTML = ''
    }
  }, [videoId, isHost, applyNow])

  // Guests follow every broadcast of the host's clock.
  useEffect(() => {
    if (isHost || !sync) return
    applyNow()
  }, [sync, isHost, applyNow])

  // The host reports its playhead, so a guest pulled back after buffering
  // drifts for seconds rather than minutes.
  useEffect(() => {
    if (!isHost) return
    const id = window.setInterval(() => {
      const player = playerRef.current
      if (!player || !readyRef.current) return
      let playing = false
      try {
        playing = player.getPlayerState?.() === YT_STATE_PLAYING
      } catch {
        return
      }
      handlersRef.current.onHeartbeat(readPosition(player), playing)
    }, HEARTBEAT_MS)
    return () => window.clearInterval(id)
  }, [isHost])

  if (failed) {
    return (
      <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-2xl bg-surface-100 p-6 text-center dark:bg-surface-900">
        <p className="text-sm font-semibold text-surface-700 dark:text-surface-300">
          The YouTube player couldn&apos;t load.
        </p>
        <p className="text-xs text-surface-500">
          Check the connection or open the video on YouTube instead.
        </p>
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 hover:underline dark:text-primary-400"
        >
          Open on YouTube <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </div>
    )
  }

  return (
    <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black">
      {/* The player replaces whatever is in here, so it must exist as a real,
          sized element before the API is pointed at it. */}
      <div ref={hostRef} className="h-full w-full" />
    </div>
  )
}

function readPosition(player: any): number {
  try {
    const value = player.getCurrentTime()
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}

export default YouTubeRoomPlayer

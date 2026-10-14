/**
 * On-demand loading of YouTube's IFrame Player API.
 *
 * Rooms need to *drive* playback (play/pause/seek on behalf of the host), which a
 * plain iframe cannot do — it only plays what the viewer clicks. So the room
 * embeds YouTube's player and talks to it over the documented API.
 *
 * The script is fetched exactly once, lazily: only after a room actually loads a
 * YouTube video. A room playing our own audio or video never contacts YouTube,
 * which is why the loader is not part of the page shell.
 *
 * `window.onYouTubeIframeAPIReady` is YouTube's own completion hook, and there
 * can only be one, so the previous holder is chained rather than overwritten —
 * the /music playlists screen and any future embed share this one instance.
 */

interface WindowWithYT {
  YT?: { Player: unknown }
  onYouTubeIframeAPIReady?: () => void
}

let pending: Promise<unknown> | null = null

export function loadYouTubeIframeApi(): Promise<unknown> {
  const w = window as unknown as WindowWithYT

  if (w.YT && typeof w.YT.Player === 'function') return Promise.resolve(w.YT)
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous()
      resolve(w.YT)
    }

    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    // Cleared rather than cached, so a network failure or a blocked script is
    // retryable the next time a room needs it.
    script.onerror = () => {
      pending = null
      reject(new Error('Could not load the YouTube player.'))
    }
    document.head.appendChild(script)
  })

  return pending
}

/** A YouTube video id is exactly eleven URL-safe characters. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * The video id behind a room's `mediaUrl`, or null.
 *
 * The backend normalises every accepted YouTube link to
 * `https://www.youtube.com/watch?v=<id>`, so the id is almost always in `v`.
 * The other shapes are handled too, in case a row predates that normalisation.
 */
export function youtubeVideoId(url?: string | null): string | null {
  if (!url) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const host = parsed.hostname.toLowerCase()
  if (!host.endsWith('youtube.com') && host !== 'youtu.be') return null

  if (host === 'youtu.be') {
    const id = parsed.pathname.split('/').filter(Boolean)[0]
    return id && VIDEO_ID.test(id) ? id : null
  }

  const v = parsed.searchParams.get('v')
  if (v && VIDEO_ID.test(v)) return v

  const match = parsed.pathname.match(/^\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/)
  return match ? match[1] : null
}

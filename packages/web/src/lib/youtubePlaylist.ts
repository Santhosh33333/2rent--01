/**
 * YouTube playlists, offered as visible embedded players.
 *
 * Scope, and why it is deliberately narrow:
 *
 * YouTube's API terms allow embedding a playlist, but forbid the things this
 * app's other three music surfaces want: no hidden or obscured player, no
 * audio-only playback, no background music, no separating the audio from the
 * video. A landing-page backdrop, an ambience prompt after a dating match and
 * a room's background score are all exactly that. So a playlist appears here on
 * /music as a real, visible player with its own controls, and nowhere else.
 *
 * The ambient player is the separate mechanism in lib/songPlayer.tsx, and it
 * only ever reads local audio files out of public/audio/. The two never mix:
 * nothing from YouTube is ever fed to <audio>, and nothing local is ever fed to
 * the iframe.
 *
 * The catalogue itself lives in youtubePlaylistData.ts, which documents how it
 * was collected and why only verified playlists are listed.
 */
import { YOUTUBE_PLAYLISTS_DATA } from './youtubePlaylistData'

/** A playlist the app will embed. */
export interface YoutubePlaylist {
  /** YouTube's playlist id: the `PL...` value from the playlist URL. */
  id: string
  /** Real playlist title, from oEmbed. Never invented. */
  title: string
  /** Real channel or author name, same source. */
  author: string
}

/**
 * The playlists available on /music, in relevance order: love and romantic
 * first, then broader Tamil music, then kuthu collections.
 *
 * Only playlists whose ids resolved against YouTube's oEmbed endpoint are
 * present. A dead id is omitted rather than shown as a row that cannot play.
 */
export const YOUTUBE_PLAYLISTS: readonly YoutubePlaylist[] = YOUTUBE_PLAYLISTS_DATA

/**
 * Case- and diacritic-tolerant search over title and author.
 *
 * Tamil playlists are commonly titled in English but tagged with Tamil script,
 * so a viewer may well type either. `String.normalize('NFD')` strips combining
 * marks, which is what makes a pasted Tamil vowel sign match the plain Latin
 * letters someone is more likely to type instead.
 */
export function searchPlaylists(
  playlists: readonly YoutubePlaylist[],
  query: string,
): YoutubePlaylist[] {
  const needle = query.trim().normalize('NFD').toLowerCase()
  if (!needle) return [...playlists]

  const match = (value: string) =>
    value.normalize('NFD').toLowerCase().includes(needle)

  return playlists.filter(
    (playlist) => match(playlist.title) || match(playlist.author),
  )
}

/** The playlist's page on youtube.com. Used for the visible attribution link. */
export function playlistPageUrl(id: string): string {
  return `https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`
}

/**
 * The embed URL for a playlist.
 *
 * `videoseries` is YouTube's playlist endpoint, and this is a plain iframe
 * rather than the IFrame Player API on purpose: an iframe needs no injected
 * third-party script and no global, so it cannot be observed or repurposed, and
 * its controls are YouTube's own rather than ones we would have to keep from
 * covering the video.
 *
 * No `autoplay` parameter is set. Playback must start from the viewer's own
 * click inside YouTube's player, which is both the audibly correct behaviour
 * for a page that also has its own ambient player, and what the terms require
 * when a video is not the page's primary content.
 */
export function playlistEmbedUrl(id: string): string {
  return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(id)}&playsinline=1`
}
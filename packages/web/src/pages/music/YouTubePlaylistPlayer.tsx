/**
 * The YouTube playlists on /music.
 *
 * A visible embedded player, and only ever visible. Nothing here is hidden,
 * overlaid, muted or used as ambience, because YouTube's terms forbid all four
 * and because a player nobody can reach is not something to ship. The iframe is
 * full size, keeps YouTube's own controls, and is never covered by another
 * element.
 *
 * Four deliberate choices:
 *
 *   - **Nothing loads until asked.** No third-party iframe, script or cookie is
 *     requested on page view. YouTube is contacted only after a playlist is
 *     chosen, and the control that does it says so. That keeps the page fast and
 *     avoids silently handing a third party visitor data on load.
 *   - **The player is the point of the click.** Playback starts from the
 *     viewer's own press of play inside YouTube's controls, so there is no
 *     autoplay and no gesture question.
 *   - **Attribution is visible.** The playlist's real title and channel are
 *     shown, and there is a link to the playlist on YouTube, rather than an
 *     anonymous frame of somebody else's work.
 *   - **Sixty-odd playlists need a way to find one.** A single scrolling strip
 *     worked for two and is unusable for sixty, so the list is searchable and
 *     reports how much of the catalogue the current filter is showing. A search
 *     that matches nothing says so rather than leaving a blank panel.
 *
 * This is a different mechanism from the ambient player in lib/songPlayer.tsx.
 * Nothing here feeds <audio>, and nothing there reaches this iframe.
 */
import { useMemo, useState } from 'react'
import { ExternalLink, Info, ListMusic, Search, X } from 'lucide-react'
import {
  YOUTUBE_PLAYLISTS,
  playlistEmbedUrl,
  playlistPageUrl,
  searchPlaylists,
  type YoutubePlaylist,
} from '../../lib/youtubePlaylist'

/**
 * How many playlists to paint at once.
 *
 * All sixty-odd are cheap - a button is a heading and a line of text - so this
 * exists to keep the scroll container responsive on a low-end phone rather than
 * to save anything meaningful. Anything the viewer has not scrolled to is
 * replaced by a short line offering the rest, so the list is never silently
 * truncated.
 */
const PAGE_SIZE = 24

export function YouTubePlaylistPlayer() {
  // null until the viewer picks one, which is what keeps YouTube unloaded on
  // page view.
  const [active, setActive] = useState<YoutubePlaylist | null>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const matches = useMemo(
    () => searchPlaylists(YOUTUBE_PLAYLISTS, query),
    [query],
  )

  // A new query resets how many rows are shown, otherwise searching after
  // scrolling a long list would land the viewer on an empty-looking panel.
  const shown = matches.slice(0, limit)
  const remaining = matches.length - shown.length

  if (YOUTUBE_PLAYLISTS.length === 0) return null

  return (
    <section aria-labelledby="nb-yt-heading" className="space-y-4">
      <div>
        <h2 id="nb-yt-heading" className="text-sm font-semibold text-surface-900 dark:text-white flex items-center gap-1.5">
          <ListMusic className="w-4 h-4 text-primary-500" aria-hidden="true" />
          YouTube playlists
        </h2>
        <p className="mt-1 text-xs text-surface-500">
          Played by YouTube, in YouTube&apos;s own player. Titles and recordings
          belong to their owners.
        </p>
      </div>

      {/* Search. Labelled rather than placeholder-only, so the field is
          announced and the count can be tied to it. */}
      <div className="space-y-2">
        <div className="relative">
          <Search
            className="w-4 h-4 text-surface-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(PAGE_SIZE)
            }}
            placeholder="Search playlists or channels"
            aria-label="Search YouTube playlists by title or channel"
            className="w-full pl-9 pr-9 py-2.5 text-sm rounded-2xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 text-surface-900 dark:text-white placeholder:text-surface-400 focus:outline-none focus:border-primary-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('')
                setLimit(PAGE_SIZE)
              }}
              aria-label="Clear playlist search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <p className="text-xs text-surface-500" role="status">
          {query
            ? `Showing ${matches.length} of ${YOUTUBE_PLAYLISTS.length} playlists`
            : `${YOUTUBE_PLAYLISTS.length} playlists`}
        </p>
      </div>

      {/* Picker. Above the player so switching is always one click, and every
          button carries the real title rather than "Playlist 1". */}
      {matches.length === 0 ? (
        <p className="text-sm text-surface-500">
          No playlist matches{' '}
          <span className="font-medium text-surface-700 dark:text-surface-300">
            {query.trim()}
          </span>
          . Try a different word, or clear the search to see all{' '}
          {YOUTUBE_PLAYLISTS.length}.
        </p>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-96 overflow-y-auto pr-1">
            {shown.map((playlist) => {
              const isActive = active?.id === playlist.id
              return (
                <li key={playlist.id}>
                  <button
                    type="button"
                    onClick={() => setActive(playlist)}
                    aria-pressed={isActive}
                    className={`w-full h-full text-left px-4 py-2.5 rounded-2xl border transition-colors ${
                      isActive
                        ? 'border-primary-400 bg-primary-50 dark:bg-primary-950/40'
                        : 'border-surface-200 dark:border-surface-800 hover:border-primary-300'
                    }`}
                  >
                    {/* Two-line clamp: several real titles run past eighty
                        characters and must not push the grid out of shape. */}
                    <span className="block text-sm font-semibold text-surface-900 dark:text-white line-clamp-2">
                      {playlist.title}
                    </span>
                    <span className="block text-xs text-surface-500 truncate">
                      {playlist.author}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
              className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
            >
              Show {Math.min(remaining, PAGE_SIZE)} more
            </button>
          )}
        </>
      )}

      {active ? (
        <div className="glass-card p-4 space-y-3">
          {/* keyed on the id so choosing another playlist reloads the frame
              rather than mutating a player we do not control */}
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              key={active.id}
              src={playlistEmbedUrl(active.id)}
              title={`YouTube playlist: ${active.title}`}
              className="w-full h-full border-0"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
            />
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-surface-500 min-w-0">
              <span className="font-medium text-surface-700 dark:text-surface-300">
                {active.title}
              </span>
              {' · '}
              {active.author}
            </p>
            <a
              href={playlistPageUrl(active.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline shrink-0"
            >
              Open on YouTube
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          </div>

          {/* Why this is not the ambient player, said plainly rather than left
              for someone to discover by waiting for background music. */}
          <p className="text-xs text-surface-500 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              These play inside YouTube&apos;s player, so they stay visible and
              keep YouTube&apos;s controls. They cannot run as background music on
              the landing page, a match or an event room - YouTube does not allow
              a hidden or audio-only player.
            </span>
          </p>
        </div>
      ) : (
        <p className="text-sm text-surface-500">
          Choose a playlist above to load the player. Nothing is requested from
          YouTube until then.
        </p>
      )}
    </section>
  )
}
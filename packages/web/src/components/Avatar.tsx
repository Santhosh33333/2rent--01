import { useEffect, useState } from 'react'
import { assetUrl } from '../lib/api'

interface AvatarProps {
  /** Raw `avatarUrl` from the API. May be a relative `/uploads/...` path. */
  src?: string | null
  /** Used for the alt text and to derive the initials fallback. */
  name?: string | null
  className?: string
  /** Tailwind text size for the initials fallback. */
  textClassName?: string
}

function initialsOf(name?: string | null): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'U'
  const parts = trimmed.split(/\s+/).filter(Boolean)
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase()
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase()
}

/**
 * The one place an avatar should be rendered.
 *
 * Every previous avatar site was hand-rolled, and the three hand-rolled
 * patterns each failed in a different way:
 *
 *  - Initials only, ignoring `avatarUrl` entirely (the header/drawer avatar on
 *    every page), so a photo that uploaded correctly never appeared outside
 *    /profile.
 *  - `src={peer.avatarUrl}` with no `assetUrl()`, so a relative `/uploads/...`
 *    resolved against the *web* origin. Dev hid this behind a Vite proxy; in
 *    production the SPA catch-all returned index.html with a 200, so the
 *    browser got HTML for an image and drew a broken-image glyph.
 *  - A truthiness check with no `onError`, so a 404 or a cold-starting API
 *    degraded to a broken glyph instead of the initials it already had a
 *    fallback for.
 *
 * Avatars are served from `/uploads/...` (public), not `/uploads/private/...`
 * (auth-gated), so a plain `<img>` request is correct here — no Authorization
 * header is needed and the image will render from any origin.
 */
export function Avatar({ src, name, className = '', textClassName = 'text-sm' }: AvatarProps) {
  const resolved = assetUrl(src)
  // Reset the error state when the URL changes, otherwise swapping a broken
  // avatar for a good one keeps rendering the fallback forever.
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [resolved])

  const base = 'rounded-full overflow-hidden shrink-0 select-none'
  const box = `${base} ${className}`

  if (!resolved || failed) {
    return (
      <div
        className={`${box} bg-gradient-to-br from-primary-500 to-accent-300 flex items-center justify-center text-white font-bold ${textClassName}`}
        aria-hidden="true"
      >
        {initialsOf(name)}
      </div>
    )
  }

  return (
    <img
      src={resolved}
      alt={name ? `${name}'s photo` : 'Profile photo'}
      className={`${box} object-cover bg-surface-200 dark:bg-surface-800`}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

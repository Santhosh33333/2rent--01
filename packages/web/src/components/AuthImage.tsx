import { useEffect, useState } from 'react'
import axios from 'axios'
import { api, assetUrl } from '../lib/api'
import { ImageOff } from 'lucide-react'

interface AuthImageProps {
  url?: string | null
  alt: string
  className?: string
}

// Renders authenticated documents (e.g. /uploads/private/... KYC images).
// The stored path is relative to the API origin — NOT under /api — so it must
// be resolved with assetUrl() before fetching, otherwise axios would hit
// /api/uploads/... and 404.
// The API origin, which is not necessarily the page origin: in dev the SPA runs
// on Vite's port and assets resolve to the backend's port.
const API_ORIGIN = (() => {
  try {
    const base = import.meta.env.VITE_API_BASE_URL as string | undefined
    return base ? new URL(base).origin : window.location.origin
  } catch {
    return window.location.origin
  }
})()

// True when `resolved` points at our own backend, so the request may carry the
// bearer token. Anything else must be fetched anonymously.
function isOwnOrigin(resolved: string): boolean {
  try {
    return new URL(resolved, window.location.origin).origin === API_ORIGIN
  } catch {
    return false
  }
}

export function AuthImage({ url, alt, className }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null

    async function load() {
      const resolved = assetUrl(url)
      if (!resolved) {
        if (active) {
          setSrc(null)
          setFailed(false)
        }
        return
      }

      // Only our own API origin gets the Authorization header. Sending a bearer
      // token to a third-party host is both a credential leak and a hard CORS
      // failure: the preflight fails and the request never reaches the server,
      // so any document stored on an external host (CDN, object storage) always
      // rendered as "Failed to load".
      try {
        const response = isOwnOrigin(resolved)
          ? // Same backend: keep the auth interceptor so private /uploads work.
            await api.get(resolved, { responseType: 'blob', timeout: 30000 })
          : // Third-party host: no credentials, so no preflight and no leak.
            await axios.get(resolved, { responseType: 'blob', timeout: 30000 })
        objectUrl = URL.createObjectURL(response.data as Blob)
        if (active) {
          setSrc(objectUrl)
          setFailed(false)
        } else {
          URL.revokeObjectURL(objectUrl)
        }
      } catch {
        if (active) {
          setSrc(null)
          setFailed(true)
        }
      }
    }

    load()

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url])

  if (!url) return null
  if (failed) {
    return (
      <div className={`${className || ''} flex flex-col items-center justify-center gap-1 bg-gray-900 text-gray-600`}>
        <ImageOff className="w-5 h-5" />
        <span className="text-[10px]">Failed to load</span>
      </div>
    )
  }
  if (!src) {
    return <div className={`${className || ''} animate-pulse bg-gray-800`} />
  }
  return <img src={src} alt={alt} className={className} />
}

import { useEffect, useState } from 'react'
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
      try {
        // Absolute URL bypasses axios baseURL but keeps the auth interceptor.
        const response = await api.get(resolved, { responseType: 'blob', timeout: 30000 })
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

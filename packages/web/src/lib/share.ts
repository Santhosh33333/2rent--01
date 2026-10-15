import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import toast from 'react-hot-toast'

/**
 * Build a shareable URL. Prefer absolute, public-facing origin for cross-device
 * sharing. Inside the native app, WebView origin is localhost, so fall back to
 * configured public origin or the published site, while also supporting
 * `VITE_PUBLIC_WEB_ORIGIN` override.
 */
export const getPublicOrigin = (): string => {
  const configured = (import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string | undefined)?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  // On web, trust the actual origin
  if (typeof window !== 'undefined' && window.location && window.location.origin.startsWith('http')) {
    // If we're on localhost inside app, fall back to the published site
    const origin = window.location.origin
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      return 'https://yuvers.in'
    }
    return origin.replace(/\/+$/, '')
  }
  return 'https://yuvers.in'
}

export const toAbsoluteUrl = (pathOrUrl: string): string => {
  const s = pathOrUrl.trim()
  if (/^https?:\/\//i.test(s)) return s
  const origin = getPublicOrigin()
  return origin + (s.startsWith('/') ? s : `/${s}`)
}

export interface ShareContent {
  title: string
  text?: string
  url: string
}

/**
 * Share content. Order:
 * 1. Capacitor native share sheet (if on native and share succeeds)
 * 2. Web Share API (if available)
 * 3. Clipboard + toast
 */
export const shareContent = async (c: ShareContent): Promise<boolean> => {
  const url = toAbsoluteUrl(c.url)
  try {
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({
          title: c.title,
          text: c.text || c.title,
          url,
        })
        return true
      } catch (e) {
        // Fall through to web share
      }
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({
        title: c.title,
        text: c.text || c.title,
        url,
      })
      return true
    }
    await navigator.clipboard.writeText(url)
    toast.success('Link copied')
    return true
  } catch {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copied')
      return true
    } catch {
      return false
    }
  }
}

/**
 * Open WhatsApp with prefilled text (uses external URL on native)
 */
export const whatsappShare = (text: string, url?: string): string => {
  const msg = url ? `${text} ${url}` : text
  return `https://wa.me/?text=${encodeURIComponent(msg)}`
}

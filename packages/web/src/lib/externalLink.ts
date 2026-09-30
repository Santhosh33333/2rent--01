import { isNativeApp } from './pushNotifications'

/**
 * Open an outbound link (cinema booking, ticket provider, website) properly on
 * both platforms.
 *
 * Inside the Capacitor Android WebView a plain `<a target="_blank">` is
 * silently dropped - no navigation, no external app, no error, so "Book" looks
 * dead. `'_system'` is the Cordova/Capacitor convention for handing a URL to the
 * system browser, and it is the same target the map links already use. On the
 * web this is an ordinary new tab with `noopener`.
 *
 * Only http(s) survives: the stored booking URL is rendered as an outbound
 * link, and a `javascript:` payload here would run in our own WebView.
 */
export function openExternalUrl(url: string | null | undefined): void {
  if (!url) return
  const trimmed = String(url).trim()
  if (!/^https?:\/\//i.test(trimmed)) return
  if (isNativeApp()) {
    window.open(trimmed, '_system', 'noopener')
    return
  }
  window.open(trimmed, '_blank', 'noopener,noreferrer')
}

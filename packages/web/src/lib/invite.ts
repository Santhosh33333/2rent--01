import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

/**
 * Canonical public origin for shareable Nabri links.
 *
 * Inside the installed app the WebView is served from https://localhost (the
 * Capacitor androidScheme), so `window.location.origin` produces links like
 * https://localhost/register?ref=RB-XXXXXXXX that are dead for anyone outside
 * the device. Every invite link therefore has to point at the deployed site.
 * Set VITE_PUBLIC_WEB_ORIGIN in Vercel to override the default.
 */
const CONFIGURED_ORIGIN = (import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string | undefined)?.trim()

/**
 * The published site, used only when no browser origin is meaningful. The
 * installed app is served from https://localhost, so a web origin can only be
 * trusted when we are genuinely on the web - and on the web the shared link
 * should follow whichever domain the user is browsing (yuvers.in, a Vercel
 * preview, ...) rather than pinning one. That is also why the env override is
 * optional: without it, invites still point at a live copy of the app.
 */
const FALLBACK_ORIGIN = 'https://2rent-01.vercel.app'

function resolveOrigin(): string {
  if (CONFIGURED_ORIGIN && CONFIGURED_ORIGIN.length > 0) return CONFIGURED_ORIGIN
  if (
    typeof window !== 'undefined' &&
    !Capacitor.isNativePlatform() &&
    /^https?:$/.test(window.location.protocol)
  ) {
    return window.location.origin
  }
  return FALLBACK_ORIGIN
}

export const PUBLIC_WEB_ORIGIN = resolveOrigin().replace(/\/+$/, '')

/** The link a friend taps. RegisterPage reads `?ref=` and prefills the code. */
export function inviteLink(code: string): string {
  return `${PUBLIC_WEB_ORIGIN}/register?ref=${encodeURIComponent(code)}`
}

/** The message body, personalised with the inviter's name when we have it. */
export function inviteMessage(code: string, inviterName?: string | null): string {
  const who = inviterName?.trim()
    ? `Your friend ${inviterName.trim()} is on Nabri`
    : "I'm on Nabri"
  return `${who} — people nearby for walks, events, dating and more. Join with my code ${code}:\n${inviteLink(code)}`
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

/**
 * Share an invite.
 *
 * Order of preference: the native share sheet (Capacitor Share, which surfaces
 * WhatsApp/Telegram/SMS on Android), then the Web Share API on the browser, then
 * the clipboard. This is the only path that reliably opens the system chooser
 * inside the Android WebView, where `navigator.share` is not always available.
 */
export async function shareInvite(code: string, inviterName?: string | null): Promise<ShareOutcome> {
  const text = inviteMessage(code, inviterName)
  const url = inviteLink(code)
  const title = 'Join me on Nabri'

  if (Capacitor.isNativePlatform()) {
    try {
      const canShare = await Share.canShare()
      if (canShare.value) {
        await Share.share({ title, text, url, dialogTitle: 'Invite a friend' })
        return 'shared'
      }
    } catch {
      // Fall through to the web share path.
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch {
      // The user dismissed the sheet, or it failed: fall through to copy.
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** A wa.me deep link that opens WhatsApp with the invite pre-typed. */
export function whatsappInviteUrl(code: string, inviterName?: string | null): string {
  return `https://wa.me/?text=${encodeURIComponent(inviteMessage(code, inviterName))}`
}

/** A pre-filled SMS link, for friends who do not use WhatsApp. */
export function smsInviteUrl(code: string, inviterName?: string | null): string {
  return `sms:?&body=${encodeURIComponent(inviteMessage(code, inviterName))}`
}

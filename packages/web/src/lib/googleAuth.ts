import { api } from './api'
import { loadScriptOnce } from './loadScript'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
          }) => void
          prompt: (callback?: (notification: any) => void) => void
          renderButton: (
            container: HTMLElement,
            options: {
              type?: 'standard' | 'icon'
              theme?: 'outline' | 'filled_blue' | 'filled_black'
              size?: 'large' | 'medium' | 'small'
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'sign_in_with'
              shape?: 'rectangular' | 'pill' | 'circle' | 'square'
              width?: number
              logo_alignment?: 'left' | 'center'
            },
          ) => void
        }
      }
    }
    __googleClientId?: string
  }
}

// Client ID is public (it ships in the browser bundle by design), but it
// belongs in env so white-label/staging builds can swap it without edits.
const GOOGLE_CLIENT_ID =
  import.meta.env.VITE_GOOGLE_CLIENT_ID ||
  window.__googleClientId ||
  '411366997531-hnplrt93hpbgssjvhcsknvofgvs9t3oe.apps.googleusercontent.com'

const GOOGLE_GSI_SRC = 'https://accounts.google.com/gsi/client'

let googleInitialized = false
let googleCallback: ((credential: string) => void) | null = null

function configureGoogle() {
  if (!window.google?.accounts?.id) return
  googleInitialized = true
  window.google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: (response) => {
      if (response.credential && googleCallback) {
        googleCallback(response.credential)
      }
    },
  })
}

/**
 * Initialise Google Identity, fetching the SDK on first use.
 *
 * The script used to be a blocking tag in index.html, so every page load paid
 * for it. It is now downloaded only when someone actually reaches the login
 * screen, and the returned promise resolves once the SDK is usable - which
 * also removes the old 200ms polling loop.
 */
export async function initGoogleSignIn(callback: (credential: string) => void): Promise<void> {
  googleCallback = callback

  if (googleInitialized) {
    configureGoogle()
    return
  }

  try {
    await loadScriptOnce(GOOGLE_GSI_SRC, 'google-gsi')
  } catch {
    // Leave the email/OTP login usable even if Google is blocked on this network.
    return
  }
  configureGoogle()
}

/**
 * Render Google's own "Sign in with Google" button into `container`.
 *
 * The custom in-app button called `prompt()`, which is the One Tap flow: it
 * silently does nothing when One Tap is suppressed (many browsers now require
 * FedCM) or when the visitor has no live Google session, so tapping the button
 * looked like a dead control. The rendered button is user-initiated and always
 * opens Google's account chooser / sign-in popup instead.
 *
 * Returns false when the SDK rendered nothing, so the caller can keep its own
 * fallback button on screen.
 */
export function renderGoogleButton(
  container: HTMLElement | null,
  text: 'signin_with' | 'signup_with' | 'continue_with' = 'continue_with',
): boolean {
  if (!container || !window.google?.accounts?.id) return false
  container.replaceChildren()
  window.google.accounts.id.renderButton(container, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    text,
    shape: 'rectangular',
    width: 320,
    logo_alignment: 'left',
  })
  return container.childElementCount > 0
}

export function promptGoogleSignIn() {
  if (window.google?.accounts?.id) {
    window.google.accounts.id.prompt()
  }
}

export async function signInWithGoogle(idToken: string): Promise<{
  accessToken: string
  refreshToken: string
  user: any
}> {
  const response = await api.post('/auth/google', { idToken })
  const res = response.data
  if (!res.success) {
    throw new Error(res.error || res.message || 'Google sign-in failed')
  }
  return res.data
}

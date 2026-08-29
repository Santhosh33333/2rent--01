import { api } from './api'

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
        }
      }
    }
    __googleClientId?: string
  }
}

const GOOGLE_CLIENT_ID = '523643092182-auoknf0n7fg27j1h91klhs8vr6v5dvej.apps.googleusercontent.com'

let googleInitialized = false
let googleCallback: ((credential: string) => void) | null = null

export function initGoogleSignIn(callback: (credential: string) => void) {
  googleCallback = callback

  if (googleInitialized && window.google?.accounts?.id) {
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => {
        if (response.credential && googleCallback) {
          googleCallback(response.credential)
        }
      },
    })
    return
  }

  const checkGoogle = setInterval(() => {
    if (window.google?.accounts?.id) {
      clearInterval(checkGoogle)
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
  }, 200)
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

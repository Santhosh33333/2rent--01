import { AuthenticateWithRedirectCallback } from '@clerk/clerk-react'

// OAuth landing route: Clerk redirects here after Google/phone verification.
// Without this route the wildcard sent users to Splash with a Clerk session
// but no app session (silent bounce). The bridge then syncs to /dashboard.
export function ClerkCallbackPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-surface-200 dark:border-surface-700 border-t-primary-500 animate-spin" />
        <p className="text-sm text-surface-500 dark:text-surface-400">Finishing sign-in…</p>
        <AuthenticateWithRedirectCallback
          signInFallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
        />
      </div>
    </div>
  )
}

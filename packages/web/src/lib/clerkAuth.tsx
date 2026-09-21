import { useEffect, useRef, useCallback, ReactNode } from 'react'
import { ClerkProvider, useSession, useUser } from '@clerk/clerk-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { api } from './api'
import { useAuth as useAppAuth } from './auth'

const CLERK_PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined

export function isClerkConfigured(): boolean {
  return Boolean(CLERK_PUBLISHABLE_KEY)
}

/**
 * Bridges a Clerk session to the app's own JWT auth:
 * Clerk signs in -> session JWT -> POST /auth/clerk -> backend verifies via
 * JWKS, links/creates the local user, returns our accessToken/refreshToken.
 * All normal API calls keep using the existing token flow.
 */
function ClerkBridge() {
  const { isSignedIn, session } = useSession()
  const { user: clerkUser } = useUser()
  const { user: appUser, updateUser, logout: appLogout } = useAppAuth()
  const navigate = useNavigate()
  const syncingRef = useRef(false)
  const lastSyncedSidRef = useRef<string | null>(null)

  const syncWithBackend = useCallback(async () => {
    if (syncingRef.current || !session || !clerkUser) return
    syncingRef.current = true
    try {
      // Session-scoped template token; short-lived, verified server-side.
      const token = await session.getToken()
      if (!token) return

      const response = await api.post('/auth/clerk', { token })
      const res = response.data
      if (res?.success && res?.data) {
        const { accessToken, refreshToken, user: apiUser } = res.data
        localStorage.setItem('token', accessToken)
        if (refreshToken) localStorage.setItem('refreshToken', refreshToken)

        const u = {
          id: apiUser.id,
          email: apiUser.email ?? clerkUser.primaryEmailAddress?.emailAddress,
          name: apiUser.fullName || clerkUser.fullName || apiUser.email,
          phone: apiUser.phone ?? clerkUser.primaryPhoneNumber?.phoneNumber,
          role: apiUser.role,
          activeRole: apiUser.activeRole || apiUser.role,
          avatarUrl: apiUser.avatarUrl || clerkUser.imageUrl,
        }
        localStorage.setItem('user', JSON.stringify(u))
        localStorage.setItem('activeRole', u.activeRole || 'USER')
        updateUser(u)
        lastSyncedSidRef.current = session.id
        navigate('/dashboard', { replace: true })
      } else {
        toast.error('Could not finish signing you in. Please try again.')
      }
    } catch (err: unknown) {
      console.error('Clerk backend sync error:', err)
      toast.error('Could not finish signing you in. Please try again.')
    } finally {
      syncingRef.current = false
    }
  }, [session, clerkUser, updateUser, navigate])

  useEffect(() => {
    if (isSignedIn && session && clerkUser && !appUser) {
      syncWithBackend()
    }
    if (!isSignedIn && appUser && lastSyncedSidRef.current) {
      // Signed out from Clerk after having synced through it.
      appLogout()
      navigate('/account-type', { replace: true })
      lastSyncedSidRef.current = null
    }
  }, [isSignedIn, session, clerkUser, appUser, syncWithBackend, appLogout, navigate])

  return null
}

export function AppClerkProvider({ children }: { children: ReactNode }) {
  if (!isClerkConfigured()) {
    // Clerk not configured: render app unchanged (password auth keeps working).
    return <>{children}</>
  }
  return (
    // ClerkProvider loads the matching clerk-js from the Clerk CDN itself.
    // (A previous self-hosted bundle drifted a major version ahead of
    // @clerk/clerk-react and broke the SignIn/SignUp UI — never vendor it.)
    <ClerkProvider
      publishableKey={CLERK_PUBLISHABLE_KEY!}
      appearance={{ variables: { colorPrimary: '#6366f1' } }}
    >
      <ClerkBridge />
      {children}
    </ClerkProvider>
  )
}
import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { isClerkConfigured } from '../../lib/clerkAuth'
import { initGoogleSignIn, signInWithGoogle } from '../../lib/googleAuth'
import { AnimatedPage } from '../../components/AnimatedPage'
import { ArrowRight, Sparkles, Mail, Lock, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const ROLE_DASHBOARDS: Record<string, string> = {
  USER: '/dashboard',
  PARTNER: '/partner/dashboard',
  ADMIN: '/admin/dashboard',
  SUPER_ADMIN: '/admin/dashboard',
  MODERATOR: '/admin/dashboard',
  SUPPORT: '/admin/dashboard',
  FINANCE: '/admin/dashboard',
}

function getDashboardForUser(user: any): string {
  const role = user?.activeRole || user?.role || 'USER'
  const normalizedRole = role.toUpperCase().replace(/\s+/g, '_')
  return ROLE_DASHBOARDS[normalizedRole] || '/dashboard'
}

export function LoginPage() {
  const navigate = useNavigate()
  const { user, login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [googleReady, setGoogleReady] = useState(false)

  useEffect(() => {
    initGoogleSignIn(handleGoogleCredential)
    const check = setInterval(() => {
      if (window.google?.accounts?.id) {
        setGoogleReady(true)
        clearInterval(check)
      }
    }, 200)
    return () => clearInterval(check)
  }, [])

  useEffect(() => {
    if (user) {
      const role = user.activeRole || user.role || 'USER'
      // Only USER-role accounts use the shared completion page; other roles go
      // straight to their own dashboard (the completion page is USER-scoped).
      if (role === 'USER' && !user.city && localStorage.getItem('profile_complete') !== 'true') {
        navigate('/profile/complete', { replace: true })
      } else {
        navigate(getDashboardForUser(user), { replace: true })
      }
    }
  }, [user, navigate])

  const handleGoogleCredential = useCallback(async (credential: string) => {
    setGoogleLoading(true)
    try {
      const data = await signInWithGoogle(credential)
      localStorage.setItem('token', data.accessToken)
      if (data.refreshToken) localStorage.setItem('refreshToken', data.refreshToken)

      const u = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.fullName || data.user.email,
        phone: data.user.phone,
        role: data.user.role,
        activeRole: data.user.activeRole || data.user.role,
        isVerified: data.user.emailVerified || data.user.mobileVerified,
        avatarUrl: data.user.avatarUrl,
      }
      localStorage.setItem('user', JSON.stringify(u))
      window.location.reload()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Google sign-in failed'))
    } finally {
      setGoogleLoading(false)
    }
  }, [])

  const handleGoogleClick = () => {
    if (!googleReady) {
      toast.error('Google sign-in is still loading. Please wait a moment.')
      return
    }
    initGoogleSignIn(handleGoogleCredential)
    setTimeout(() => {
      window.google?.accounts?.id?.prompt()
    }, 100)
  }

  const handleEmailLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setLoading(true)
    setApiError(null)

    const formData = new FormData(e.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    try {
      await login(email, password)
      toast.success('Welcome back!')
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Login failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 px-4 py-12 transition-colors duration-400">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary-400/10 rounded-full blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-accent-400/10 rounded-full blur-[128px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-500/5 rounded-full blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md">
        <AnimatedPage>
          <div className="text-center mb-10">
            <img
              src="/logo-mark.svg"
              alt="RentBuddy logo"
              className="inline-block w-16 h-16 rounded-2xl shadow-xl shadow-primary-500/25 mb-5 animate-float"
            />
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">
              Welcome back
            </h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">
              Sign in to continue with RentBuddy
            </p>
          </div>

          <div className="glass-elevated p-8">
            <button
              onClick={handleGoogleClick}
              disabled={googleLoading}
              className="btn-outline w-full btn-lg group mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="flex items-center justify-center gap-2">
                {googleLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                {googleLoading ? 'Signing in...' : 'Continue with Google'}
              </span>
            </button>

            <div className="divider my-7">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3 h-3" />
                or sign in with password
              </span>
            </div>

            <form onSubmit={handleEmailLogin} className="space-y-5">
              <div>
                <label htmlFor="email" className="label">Email address</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                  <input
                    name="email"
                    type="email"
                    id="email"
                    className="input pl-11"
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label htmlFor="password" className="label mb-0">Password</label>
                  <Link
                    to="/forgot-password"
                    className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-500 transition-colors"
                  >
                    Forgot password?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                  <input
                    name="password"
                    type="password"
                    id="password"
                    className="input pl-11"
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>

              {apiError && (
                <div className="rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 px-4 py-3 animate-scale-in">
                  <p className="text-sm text-danger-600 dark:text-danger-400">{apiError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="btn-gradient w-full btn-lg group"
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                    Signing in...
                  </span>
                ) : (
                  <span className="flex items-center justify-center gap-2">
                    Sign in
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                )}
              </button>
            </form>

            {isClerkConfigured() && (
              <div className="mt-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
                  <span className="text-xs text-surface-400">or</span>
                  <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
                </div>
                <Link
                  to="/sign-in"
                  className="w-full py-3 rounded-xl border border-surface-300 dark:border-surface-600 text-sm font-semibold text-surface-700 dark:text-surface-200 hover:border-primary-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center justify-center"
                >
                  Continue with Clerk&nbsp;Â·&nbsp;Google, OTP & more
                </Link>
              </div>
            )}
          </div>

          <p className="mt-8 text-center text-sm text-surface-500 dark:text-surface-400">
            Don't have an account?{' '}
            <Link
              to="/register"
              className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-500 transition-colors"
            >
              Create one
            </Link>
          </p>
        </AnimatedPage>
      </div>
    </div>
  )
}
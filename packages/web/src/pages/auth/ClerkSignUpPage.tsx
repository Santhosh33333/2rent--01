import { SignUp } from '@clerk/clerk-react'
import { Link, Navigate } from 'react-router-dom'
import { ClerkBoundary, isClerkConfigured } from '../../lib/clerkAuth'

export function ClerkSignUpPage() {
  if (!isClerkConfigured()) return <Navigate to="/register" replace />

  return (
    <ClerkBoundary>
    <main className="auth-backdrop auth-editorial">
        <section className="auth-story" aria-label="Nabri introduction">
        <Link to="/" className="relative z-10 flex items-center gap-3 text-xl font-extrabold font-display tracking-[-0.06em] text-white">
          <img src="/logo-mark.svg" alt="" className="w-10 h-10" /> NABRI<span className="ml-1 h-2 w-2 bg-accent-300" />
        </Link>
        <div className="relative z-10 max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent-300">Better, together</p>
          <h1 className="mt-5 text-5xl xl:text-7xl font-extrabold font-display leading-[0.98] tracking-[-0.055em]">Make room<br />for <span className="text-primary-400">more.</span></h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-surface-300">A new spot, a shared ride, a familiar face. Your next favorite local thing is closer than you think.</p>
        </div>
        <p className="relative z-10 text-xs uppercase tracking-[0.16em] text-surface-400">Good plans start around the corner.</p>
        <span aria-hidden="true" className="absolute right-[18%] top-[28%] z-10 -rotate-6 border border-primary-400/50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-primary-300">Come on in</span>
      </section>
      <section className="auth-clerk-panel">
        <div className="w-full max-w-md">
        <div className="auth-mobile-mast">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold font-display tracking-tight"><img src="/logo-mark.svg" alt="" className="w-9 h-9" /> NABRI</Link>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary-600 dark:text-primary-300">Better, together</span>
        </div>
        <div className="mb-6 px-1 text-center lg:text-left">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">Your neighborhood awaits</p>
          <h1 className="mt-2 text-3xl font-extrabold font-display tracking-tight text-surface-900 dark:text-surface-50">Create your account</h1>
        </div>
        <SignUp
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
          signInFallbackRedirectUrl="/dashboard"
          appearance={{ variables: { colorPrimary: '#d83d27', colorBackground: '#fbf7ef', colorText: '#1c1917', colorInputBackground: '#ffffff', colorInputText: '#1c1917', borderRadius: '0.75rem' } }}
        />
        <p className="text-center text-sm text-surface-500 dark:text-surface-400 mt-6">
          Prefer email &amp; password?{' '}
          <Link to="/register" className="text-primary-500 hover:text-primary-600 font-medium">Register here</Link>
        </p>
        </div>
      </section>
    </main>
    </ClerkBoundary>
  )
}

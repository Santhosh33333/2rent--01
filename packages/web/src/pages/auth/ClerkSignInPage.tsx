import { SignIn } from '@clerk/clerk-react'
import { Link, Navigate } from 'react-router-dom'
import { ClerkBoundary, isClerkConfigured } from '../../lib/clerkAuth'

export function ClerkSignInPage() {
  if (!isClerkConfigured()) return <Navigate to="/login" replace />

  return (
    <ClerkBoundary>
    <main className="auth-backdrop auth-editorial">
        <section className="auth-story" aria-label="Nabri introduction">
        <Link to="/" className="relative z-10 flex items-center gap-3 text-xl font-extrabold font-display tracking-[-0.06em] text-white">
          <img src="/logo-mark.svg" alt="" className="w-10 h-10" /> NABRI<span className="ml-1 h-2 w-2 bg-accent-300" />
        </Link>
        <div className="relative z-10 max-w-xl">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-accent-300">Your city, closer</p>
          <h1 className="mt-5 text-5xl xl:text-7xl font-extrabold font-display leading-[0.98] tracking-[-0.055em]">Good things<br />happen <span className="text-primary-400">nearby.</span></h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-surface-300">Find your people, discover local experiences, and make more of the neighborhood you call home.</p>
        </div>
        <p className="relative z-10 text-xs uppercase tracking-[0.16em] text-surface-400">Meet your side of the city. &nbsp;/&nbsp; Est. for real life</p>
        <span aria-hidden="true" className="absolute right-[18%] top-[28%] z-10 rotate-12 border border-primary-400/50 px-4 py-2 text-xs uppercase tracking-[0.2em] text-primary-300">Local, always</span>
      </section>
      <section className="auth-clerk-panel">
        <div className="w-full max-w-md">
        <div className="auth-mobile-mast">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold font-display tracking-tight"><img src="/logo-mark.svg" alt="" className="w-9 h-9" /> NABRI</Link>
          <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary-600 dark:text-primary-300">Your city, closer</span>
        </div>
        <div className="mb-6 px-1 text-center lg:text-left">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-600 dark:text-primary-300">Welcome back</p>
          <h1 className="mt-2 text-3xl font-extrabold font-display tracking-tight text-surface-900 dark:text-surface-50">Sign in to Nabri</h1>
        </div>
        <SignIn
          signUpUrl="/sign-up"
          fallbackRedirectUrl="/dashboard"
          signUpFallbackRedirectUrl="/dashboard"
          appearance={{ variables: { colorPrimary: '#d83d27', colorBackground: '#fbf7ef', colorText: '#1c1917', colorInputBackground: '#ffffff', colorInputText: '#1c1917', borderRadius: '0.75rem' } }}
        />
        <p className="text-center text-sm text-surface-500 dark:text-surface-400 mt-6">
          Prefer email &amp; password?{' '}
          <Link to="/login" className="text-primary-500 hover:text-primary-600 font-medium">Sign in here</Link>
        </p>
        </div>
      </section>
    </main>
    </ClerkBoundary>
  )
}

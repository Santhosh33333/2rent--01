import { SignUp } from '@clerk/clerk-react'
import { Link } from 'react-router-dom'

export function ClerkSignUpPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12 bg-surface-50 dark:bg-surface-950">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-block text-2xl font-bold font-display gradient-text">RentBuddy</Link>
          <p className="text-sm text-surface-500 dark:text-surface-400 mt-2">
            Create your account with Clerk — email, Google, OTP & more
          </p>
        </div>
        <SignUp
          signInUrl="/sign-in"
          fallbackRedirectUrl="/dashboard"
          signInFallbackRedirectUrl="/dashboard"
          appearance={{ variables: { colorPrimary: '#6366f1' } }}
        />
        <p className="text-center text-sm text-surface-500 dark:text-surface-400 mt-6">
          Prefer email &amp; password?{' '}
          <Link to="/register" className="text-primary-500 hover:text-primary-600 font-medium">Register here</Link>
        </p>
      </div>
    </div>
  )
}

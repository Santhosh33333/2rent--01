import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AnimatedPage } from '../../components/AnimatedPage'
import { Clock, ArrowRight } from 'lucide-react'

/**
 * Phone verification by SMS OTP is currently switched off on the server
 * (`POST /auth/verify-mobile` and `/auth/resend-otp` both refuse). This page
 * therefore never collects a code: showing an OTP box that can only fail would
 * be a dead end and would imply a number could be confirmed right now.
 *
 * It states the truth instead: the number is saved, it is unverified, and
 * verification will arrive in a future update. Restore the form when
 * `PHONE_VERIFICATION_ENABLED` is turned on in
 * `packages/backend/src/services/phoneVisibility.ts`.
 */
export function VerifyMobilePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userId = searchParams.get('userId') || ''
  const phone = searchParams.get('phone') || ''

  useEffect(() => {
    if (!userId) {
      navigate('/login', { replace: true })
    }
  }, [userId, navigate])

  return (
    <div className="min-h-screen flex bg-surface-50 dark:bg-surface-950 px-4 py-12 transition-colors duration-400">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary-400/10 rounded-full blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 w-[400px] h-[400px] bg-accent-400/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md m-auto">
        <AnimatedPage>
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary-500/15 border border-primary-500/25 mb-5">
              <Clock className="w-8 h-8 text-primary-500" />
            </div>
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">
              Verification coming soon
            </h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">
              {phone ? `${phone} is saved on your account.` : 'Your mobile number is saved on your account.'}
            </p>
          </div>

          <div className="glass-elevated p-8 space-y-5">
            <p className="text-sm text-surface-600 dark:text-surface-300 leading-relaxed">
              Mobile number verification is not available right now. Your number has been
              saved, but it is marked as <strong>unverified</strong> until we enable
              verification.
            </p>
            <p className="text-sm text-surface-500 dark:text-surface-400 leading-relaxed">
              Nothing is lost &mdash; you can continue using Nabri. If you need your number
              corrected, please contact Nabri support, as only an administrator can change it.
            </p>

            <button
              type="button"
              onClick={() => navigate('/login', { replace: true })}
              className="btn-gradient w-full btn-lg group"
            >
              <span className="flex items-center justify-center gap-2">
                Continue to login
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}

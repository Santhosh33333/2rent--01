import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { Smartphone, ArrowRight, RefreshCw, CheckCircle } from 'lucide-react'

export function VerifyMobilePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const userId = searchParams.get('userId') || ''
  const phone = searchParams.get('phone') || ''

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (!userId) {
      navigate('/login', { replace: true })
    }
  }, [userId, navigate])

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otp.length !== 6 || !userId) return
    setLoading(true)
    setApiError(null)
    try {
      await api.post('/auth/verify-mobile', { userId, otp })
      setSuccess(true)
      toast.success('Mobile verified successfully!')
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Verification failed'))
    } finally {
      setLoading(false)
    }
  }

  const handleResend = useCallback(async () => {
    if (!userId || cooldown > 0) return
    setApiError(null)
    try {
      await api.post('/auth/resend-otp', { userId, channel: 'mobile' })
      toast.success('OTP resent to your mobile')
      setCooldown(60)
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Failed to resend OTP'))
    }
  }, [userId, cooldown])

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 px-4 py-12 transition-colors duration-400">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary-400/10 rounded-full blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-accent-400/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md">
        <AnimatedPage>
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary-500 via-primary-400 to-accent-500 shadow-xl shadow-primary-500/25 mb-5 animate-float">
              <Smartphone className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">
              {success ? 'Verified!' : 'Verify your mobile'}
            </h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">
              {success
                ? 'Redirecting you to login...'
                : phone
                  ? `We sent a 6-digit code to ${phone}`
                  : 'Enter the 6-digit code sent to your mobile'}
            </p>
          </div>

          <div className="glass-elevated p-8">
            {success ? (
              <div className="text-center py-4">
                <CheckCircle className="w-16 h-16 text-success-500 mx-auto mb-4" />
                <p className="text-surface-600 dark:text-surface-300">Mobile verified successfully</p>
              </div>
            ) : (
              <form onSubmit={handleVerify} className="space-y-5">
                <div>
                  <label htmlFor="otp" className="label">Enter verification code</label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    className="input text-center tracking-widest text-2xl"
                    placeholder="000000"
                    autoFocus
                    required
                  />
                </div>

                {apiError && (
                  <div className="rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 px-4 py-3 animate-scale-in">
                    <p className="text-sm text-danger-600 dark:text-danger-400">{apiError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || otp.length !== 6}
                  className="btn-gradient w-full btn-lg group"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Verifying...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Verify Mobile
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResend}
                  disabled={cooldown > 0}
                  className="btn-outline w-full btn-lg"
                >
                  <span className="flex items-center justify-center gap-2">
                    <RefreshCw className={`w-4 h-4 ${cooldown > 0 ? 'animate-spin' : ''}`} />
                    {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
                  </span>
                </button>
              </form>
            )}
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}
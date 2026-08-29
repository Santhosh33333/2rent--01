import { getErrorMessage } from '../../lib/error'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Mail, ArrowLeft, ArrowRight, CheckCircle, Lock, Eye, EyeOff } from 'lucide-react'
import { api } from '../../lib/api'

const emailSchema = z.object({ email: z.string().email('Enter a valid email') })
const otpSchema = z.object({ otp: z.string().length(6, 'OTP must be 6 digits') })
const resetSchema = z.object({
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, { message: "Passwords don't match", path: ['confirmPassword'] })

type EmailForm = z.infer<typeof emailSchema>
type OtpForm = z.infer<typeof otpSchema>
type ResetForm = z.infer<typeof resetSchema>

export function ForgotPasswordPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [loading, setLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [devOtp, setDevOtp] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const emailForm = useForm<EmailForm>({ resolver: zodResolver(emailSchema) })
  const otpForm = useForm<OtpForm>({ resolver: zodResolver(otpSchema) })
  const resetForm = useForm<ResetForm>({ resolver: zodResolver(resetSchema) })

  const onEmailSubmit = async (data: EmailForm) => {
    try {
      setLoading(true)
      setApiError(null)
      setEmail(data.email)
      const res = await api.post('/auth/forgot-password', { email: data.email })
      const result = res.data
      if (result.data?.otp) {
        setDevOtp(result.data.otp)
      }
      toast.success('OTP sent to your email')
      setStep(2)
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Failed to send OTP'))
    } finally {
      setLoading(false)
    }
  }

  const onOtpSubmit = async (_data: OtpForm) => {
    try {
      setLoading(true)
      setApiError(null)
      setStep(3)
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Invalid OTP'))
    } finally {
      setLoading(false)
    }
  }

  const onResetSubmit = async (data: ResetForm) => {
    try {
      setLoading(true)
      setApiError(null)
      const otp = otpForm.getValues('otp')
      await api.post('/auth/reset-password', {
        email,
        otp,
        newPassword: data.password,
      })
      toast.success('Password reset successful!')
      navigate('/login', { replace: true })
    } catch (err: unknown) {
      setApiError(getErrorMessage(err, 'Failed to reset password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 px-4 py-12">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-primary-400/15 rounded-full blur-[100px]" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-accent-400/15 rounded-full blur-[100px]" />
      </div>

      <div className="relative w-full max-w-md">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm font-medium text-surface-500 dark:text-surface-400 hover:text-surface-700 dark:hover:text-surface-200 transition-colors mb-8">
          <ArrowLeft className="w-4 h-4" />
          Back to Sign In
        </Link>

        {/* Step 1: Enter email */}
        {step === 1 && (
          <div className="animate-fade-in-up">
            <div className="mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 mb-5">
                <Mail className="w-7 h-7 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white">Forgot password?</h1>
              <p className="mt-2 text-surface-500 dark:text-surface-400">Enter your email and we'll send you a reset OTP</p>
            </div>
            <div className="glass-elevated p-8">
              <form onSubmit={emailForm.handleSubmit(onEmailSubmit)} className="space-y-5">
                <div>
                  <label className="label">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                    <input {...emailForm.register('email')} type="email" className="input pl-11" placeholder="you@example.com" />
                  </div>
                  {emailForm.formState.errors.email && <p className="mt-2 text-xs text-danger-500 font-medium">{emailForm.formState.errors.email.message}</p>}
                </div>
                {apiError && (
                  <div className="rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 px-4 py-3">
                    <p className="text-sm text-danger-600 dark:text-danger-400">{apiError}</p>
                  </div>
                )}
                <button type="submit" disabled={loading} className="btn-gradient w-full btn-lg group">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Sending...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Send OTP <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Step 2: Enter OTP */}
        {step === 2 && (
          <div className="animate-fade-in-up">
            <div className="mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-100 dark:bg-primary-900/30 mb-5">
                <Mail className="w-7 h-7 text-primary-600 dark:text-primary-400" />
              </div>
              <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white">Enter OTP</h1>
              <p className="mt-2 text-surface-500 dark:text-surface-400">We sent a 6-digit code to {email}</p>
            </div>
            {devOtp && (
              <div className="glass-elevated p-4 mb-4 border-2 border-amber-300 dark:border-amber-600">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase mb-1">Dev Mode â€” Your OTP:</p>
                <p className="text-2xl font-mono font-bold text-amber-700 dark:text-amber-300 tracking-widest">{devOtp}</p>
              </div>
            )}
            <div className="glass-elevated p-8">
              <form onSubmit={otpForm.handleSubmit(onOtpSubmit)} className="space-y-5">
                <div>
                  <label className="label">6-digit OTP</label>
                  <input {...otpForm.register('otp')} type="text" className="input text-center text-2xl tracking-widest font-mono" placeholder="000000" maxLength={6} />
                  {otpForm.formState.errors.otp && <p className="mt-2 text-xs text-danger-500 font-medium">{otpForm.formState.errors.otp.message}</p>}
                </div>
                {apiError && (
                  <div className="rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 px-4 py-3">
                    <p className="text-sm text-danger-600 dark:text-danger-400">{apiError}</p>
                  </div>
                )}
                <button type="submit" disabled={loading} className="btn-gradient w-full btn-lg group">
                  <span className="flex items-center justify-center gap-2">
                    Verify OTP <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Step 3: New password */}
        {step === 3 && (
          <div className="animate-fade-in-up">
            <div className="mb-8">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 mb-5">
                <Lock className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
              </div>
              <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white">New Password</h1>
              <p className="mt-2 text-surface-500 dark:text-surface-400">Create a strong new password</p>
            </div>
            <div className="glass-elevated p-8">
              <form onSubmit={resetForm.handleSubmit(onResetSubmit)} className="space-y-5">
                <div>
                  <label className="label">New Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                    <input {...resetForm.register('password')} type={showPassword ? 'text' : 'password'} className="input pl-11 pr-11" placeholder="New password" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors">
                      {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                    </button>
                  </div>
                  {resetForm.formState.errors.password && <p className="mt-2 text-xs text-danger-500 font-medium">{resetForm.formState.errors.password.message}</p>}
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                    <input {...resetForm.register('confirmPassword')} type="password" className="input pl-11" placeholder="Confirm password" />
                  </div>
                  {resetForm.formState.errors.confirmPassword && <p className="mt-2 text-xs text-danger-500 font-medium">{resetForm.formState.errors.confirmPassword.message}</p>}
                </div>
                {apiError && (
                  <div className="rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 px-4 py-3">
                    <p className="text-sm text-danger-600 dark:text-danger-400">{apiError}</p>
                  </div>
                )}
                <button type="submit" disabled={loading} className="btn-gradient w-full btn-lg group">
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Resetting...
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      Reset Password <CheckCircle className="w-4 h-4" />
                    </span>
                  )}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
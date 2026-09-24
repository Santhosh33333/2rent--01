import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check, Sparkles, Cake, KeyRound, ShieldCheck, RefreshCw } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'

function ageFrom(dob: string): number {
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) return -1
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

const GENDERS = [
  { value: 'MALE', label: 'Male', icon: '👨' },
  { value: 'FEMALE', label: 'Female', icon: '👩' },
  { value: 'OTHER', label: 'Other', icon: '🧑' },
]

const MAX_DOB = new Date()
MAX_DOB.setFullYear(MAX_DOB.getFullYear() - 18)

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  gender: z.string().min(1, 'Please select your gender'),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  phone: z.string().min(10, 'Phone number must be at least 10 digits'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  referralCode: z.string().optional(),
  terms: z.boolean().refine(val => val === true, 'You must accept the terms and conditions'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
}).refine((data) => ageFrom(data.dateOfBirth) >= 18, {
  message: 'You must be 18 or older to create an account',
  path: ["dateOfBirth"],
})

type RegisterForm = z.infer<typeof registerSchema>

type OtpStatus = 'idle' | 'sending' | 'sent' | 'verifying' | 'verified' | 'error'

const steps = [
  { id: 1, title: 'Account Type', subtitle: 'Choose how you want to use Nabri' },
  { id: 2, title: 'Personal Info', subtitle: 'Your name and email' },
  { id: 3, title: 'About You', subtitle: 'Gender & date of birth' },
  { id: 4, title: 'Security', subtitle: 'Phone & password' },
  { id: 5, title: 'Confirm', subtitle: 'Review & agree' },
]

export function RegisterPage() {
  const { register: registerUser, user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [accountType, setAccountType] = useState<'USER' | 'PARTNER'>(() =>
    (location.state as any)?.accountType === 'PARTNER' ? 'PARTNER' : 'USER'
  )

  const [otpStatus, setOtpStatus] = useState<OtpStatus>('idle')
  const [otpError, setOtpError] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [otpResendIn, setOtpResendIn] = useState(0)
  const verifiedEmailRef = useRef('')

  useEffect(() => {
    if (authLoading || !user) return
    const role = user.activeRole || user.role || 'USER'
    navigate(role === 'USER' ? '/profile/complete' : '/partner/dashboard', { replace: true })
  }, [user, authLoading, navigate])

  const { register, handleSubmit, watch, trigger, setValue, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
  })

  const emailValue = watch('email')

  // If the user changes the email after verifying, reset the inline OTP state.
  useEffect(() => {
    const current = (emailValue || '').trim().toLowerCase()
    if (otpStatus === 'verified' && verifiedEmailRef.current && current !== verifiedEmailRef.current) {
      setOtpStatus('idle')
      setOtpCode('')
      setOtpError('')
      verifiedEmailRef.current = ''
    }
  }, [emailValue, otpStatus])

  useEffect(() => {
    if (otpResendIn <= 0) return
    const timer = setTimeout(() => setOtpResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [otpResendIn])

  const requestEmailOtp = async () => {
    const valid = await trigger('email')
    if (!valid) return
    const email = (watch('email') || '').trim().toLowerCase()
    try {
      setOtpStatus('sending')
      setOtpError('')
      const res = await api.post('/auth/signup/request-otp', { email })
      setOtpStatus('sent')
      const data = res.data?.data || {}
      setOtpResendIn(Number(data.resendInSec) || 30)
      toast.success(`Verification code sent to ${data.maskedTo || email}`)
    } catch (err: unknown) {
      setOtpStatus('error')
      setOtpError(getErrorMessage(err, 'Could not send the verification code.'))
    }
  }

  const verifyEmailOtp = async () => {
    const email = (watch('email') || '').trim().toLowerCase()
    if (otpCode.replace(/\D/g, '').length < 4) {
      setOtpError('Enter the 6-digit code from your email.')
      return
    }
    try {
      setOtpStatus('verifying')
      setOtpError('')
      await api.post('/auth/signup/verify-otp', { email, code: otpCode.replace(/\D/g, '') })
      verifiedEmailRef.current = email
      setOtpStatus('verified')
      toast.success('Email verified!')
    } catch (err: unknown) {
      setOtpStatus('sent')
      setOtpError(getErrorMessage(err, 'Invalid or expired code. Check and try again.'))
    }
  }

  const handleNext = async () => {
    let fields: (keyof RegisterForm)[] = []
    if (step === 1) {
      setStep(2)
      return
    }
    if (step === 2) {
      const valid = await trigger(['name', 'email'])
      if (!valid) return
      if (otpStatus !== 'verified') {
        toast.error('Verify your email first with the OTP code.')
        return
      }
      setStep(3)
      return
    }
    if (step === 3) fields = ['gender', 'dateOfBirth']
    if (step === 4) fields = ['phone', 'password', 'confirmPassword']
    const valid = await trigger(fields)
    if (valid) setStep(step + 1)
  }

  const onSubmit = async (data: RegisterForm) => {
    try {
      setLoading(true)
      const isReferral = data.referralCode && data.referralCode.trim().length > 0
      const result = await registerUser({
        fullName: data.name,
        name: data.name,
        email: data.email,
        phone: data.phone,
        password: data.password,
        accountType,
        role: accountType,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender || 'OTHER',
      })
      // If the user signed up with a valid referral code, link them as soon as
      // the account exists. Non-fatal on failure (e.g. invalid/unused code).
      if (isReferral) {
        try {
          await api.post('/referrals/apply', { code: data.referralCode!.trim() })
        } catch {
          /* best-effort — invalid codes are simply ignored */
        }
      }
      toast.success('Registration successful!')
      const userId = result?.userId || user?.id
      if (userId) {
        const emailVerified = result?.verification?.emailVerified === true
        if (emailVerified) {
          // Email was verified inline during signup — straight to mobile verify.
          navigate(
            `/verify-mobile?userId=${encodeURIComponent(userId)}&phone=${encodeURIComponent(data.phone)}`,
            { replace: true }
          )
        } else {
          navigate(
            `/verify-email?userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(result?.email || data.email)}&next=verify-mobile`,
            { replace: true }
          )
        }
      } else {
        navigate(accountType === 'USER' ? '/profile/complete' : '/partner/dashboard', { replace: true })
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Registration failed. Please check your details and try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-backdrop transition-colors duration-400">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary-400/10 rounded-full blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-accent-400/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md m-auto">
        <AnimatedPage>
          {/* Logo */}
<div className="text-center mb-8">
            <div className="logo-3d mb-5">
              <img
                src="/images/logo-mark-3d.png"
                alt="Nabri logo"
                className="w-16 h-16"
              />
            </div>
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">Create account</h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">Join the Nabri community</p>
          </div>

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-2 mb-6">
            {steps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className={`flex items-center justify-center w-9 h-9 rounded-xl text-xs font-bold transition-all duration-500 ${
                  step > s.id
                    ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                    : step === s.id
                    ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-2 border-primary-400 dark:border-primary-500'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
                }`}>
                  {step > s.id ? <Check className="w-4 h-4" /> : s.id}
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-10 h-0.5 rounded-full transition-colors duration-500 ${
                    step > s.id ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'
                  }`} />
                )}
              </div>
            ))}
          </div>

          {/* Card */}
          <div className="glass-elevated p-8">
            <div className="text-center mb-6">
              <h3 className="text-lg font-bold font-display text-surface-900 dark:text-white">{steps[step - 1].title}</h3>
              <p className="text-sm text-surface-500 mt-1">{steps[step - 1].subtitle}</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {step === 1 && (
                <>
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setAccountType('USER')}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        accountType === 'USER'
                          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
                          : 'border-surface-200 bg-white text-surface-700 hover:border-primary-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">I'm a User</div>
                          <div className="text-sm opacity-75">Book services, discover local help, and manage my account</div>
                        </div>
                        <div className="text-xl">👤</div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountType('PARTNER')}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        accountType === 'PARTNER'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'border-surface-200 bg-white text-surface-700 hover:border-emerald-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-semibold">I'm a Partner</div>
                          <div className="text-sm opacity-75">Offer services, accept work, and get paid securely</div>
                        </div>
                        <div className="text-xl">🤝</div>
                      </div>
                    </button>
                  </div>

                  <button type="button" onClick={handleNext} className="btn-gradient w-full btn-lg group">
                    <span className="flex items-center justify-center gap-2">
                      Continue
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </button>
                </>
              )}

              {step === 2 && (
                <>
                  <div>
                    <label htmlFor="name" className="label">Full Name</label>
                    <div className="relative">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('name')} type="text" id="name" className="input pl-11" placeholder="John Doe" />
                    </div>
                    {errors.name && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.name.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="email" className="label">Email address</label>
                    <div className="relative">
                      <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('email')} type="email" id="email" disabled={otpStatus === 'verified'} className={`input pl-11 ${otpStatus === 'verified' ? 'opacity-70 cursor-not-allowed' : ''}`} placeholder="you@example.com" />
                    </div>
                    {errors.email && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.email.message}</p>}
                  </div>

                  {/* Inline email verification (OTP during signup) */}
                  <div className={`rounded-2xl border p-4 transition ${otpStatus === 'verified' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 dark:border-emerald-700' : 'border-surface-200 bg-white dark:bg-surface-900 dark:border-surface-700'}`}>
                    {otpStatus !== 'verified' ? (
                      <>
                        <div className="text-sm font-semibold text-surface-800 dark:text-surface-100 mb-1">Verify your email</div>
                        <p className="text-xs text-surface-500 mb-3">We'll send a one-time code to your inbox to prove this address is yours.</p>
                        {otpStatus === 'idle' || otpStatus === 'error' || otpStatus === 'sending' ? (
                          <button
                            type="button"
                            onClick={requestEmailOtp}
                            disabled={otpStatus === 'sending'}
                            className="w-full rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300 border border-primary-200 dark:border-primary-700 px-4 py-2.5 text-sm font-semibold transition hover:bg-primary-100 disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {otpStatus === 'sending' ? (
                              <span className="flex items-center justify-center gap-2">
                                <span className="w-3.5 h-3.5 rounded-full border-2 border-primary-300 border-t-primary-600 animate-spin" />
                                Sending code...
                              </span>
                            ) : (
                              <span className="flex items-center justify-center gap-2">Send verification code</span>
                            )}
                          </button>
                        ) : otpStatus === 'sent' || otpStatus === 'verifying' ? (
                          <div className="space-y-3">
                            <div className="relative">
                              <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                              <input
                                value={otpCode}
                                onChange={(e) => {
                                  setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                                  setOtpError('')
                                }}
                                inputMode="numeric"
                                maxLength={6}
                                placeholder="Enter 6-digit code"
                                className="input pl-11"
                              />
                            </div>
                            {otpError && <p className="text-xs text-danger-500 font-medium">{otpError}</p>}
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={verifyEmailOtp}
                                disabled={otpStatus === 'verifying' || otpCode.replace(/\D/g, '').length < 4}
                                className="flex-1 rounded-xl bg-primary-500 text-white px-4 py-2.5 text-sm font-semibold transition hover:bg-primary-600 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {otpStatus === 'verifying' ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                                    Verifying...
                                  </span>
                                ) : (
                                  'Verify email'
                                )}
                              </button>
                              {otpResendIn > 0 ? (
                                <span className="flex items-center justify-center whitespace-nowrap text-xs text-surface-500 px-2">Resend in {otpResendIn}s</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={requestEmailOtp}
                                  className="flex items-center justify-center gap-1.5 rounded-xl border border-surface-200 dark:border-surface-700 px-3 py-2.5 text-xs font-semibold text-surface-600 dark:text-surface-300 transition hover:bg-surface-100 dark:hover:bg-surface-800"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  Resend
                                </button>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-danger-500 font-medium">{otpError || 'Something went wrong.'}</p>
                        )}
                      </>
                    ) : (
                      <div className="flex items-center gap-2.5">
                        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div>
                          <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">Email verified</div>
                          <div className="text-xs text-emerald-600/80 dark:text-emerald-400/80">This address is confirmed. You can continue.</div>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <label htmlFor="referralCode" className="label">Referral Code <span className="text-surface-400 font-normal">(optional)</span></label>
                    <div className="relative">
                      <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('referralCode')} type="text" id="referralCode" className="input pl-11 uppercase" placeholder="RB-XXXXXXXX" />
                    </div>
                    <p className="mt-2 text-xs text-surface-500">Enter a friend's code to earn a sign-up reward on both sides.</p>
                  </div>
                  <button type="button" onClick={handleNext} className="btn-gradient w-full btn-lg group">
                    <span className="flex items-center justify-center gap-2">
                      Continue
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                  </button>
                </>
              )}

              {step === 3 && (
                <>
                  <div>
                    <label className="label">Gender</label>
                    <div className="grid grid-cols-3 gap-2">
                      {GENDERS.map((g) => (
                        <button
                          key={g.value}
                          type="button"
                          onClick={() => setValue('gender', g.value, { shouldValidate: true })}
                          className={`rounded-xl border px-2 py-3 text-center transition ${
                            watch('gender') === g.value
                              ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
                              : 'border-surface-200 bg-white text-surface-700 hover:border-primary-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                          }`}
                        >
                          <div className="text-xl mb-1">{g.icon}</div>
                          <div className="text-xs font-semibold truncate">{g.label}</div>
                        </button>
                      ))}
                    </div>
                    {errors.gender && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.gender.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="dateOfBirth" className="label">Date of Birth</label>
                    <div className="relative">
                      <Cake className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input
                        {...register('dateOfBirth')}
                        type="date"
                        id="dateOfBirth"
                        max={MAX_DOB.toISOString().split('T')[0]}
                        className="input pl-11"
                      />
                    </div>
                    {errors.dateOfBirth ? (
                      <p className="mt-2 text-xs text-danger-500 font-medium">{errors.dateOfBirth.message}</p>
                    ) : (
                      <p className="mt-2 text-xs text-surface-500">You must be 18 or older to create an account.</p>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(2)} className="btn-outline flex-1">
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>
                    <button type="button" onClick={handleNext} className="btn-gradient flex-1 group">
                      <span className="flex items-center justify-center gap-2">
                        Continue
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </button>
                  </div>
                </>
              )}

              {step === 4 && (
                <>
                  <div>
                    <label htmlFor="phone" className="label">Phone Number</label>
                    <div className="relative">
                      <Phone className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('phone')} type="tel" id="phone" className="input pl-11" placeholder="+91 98765 43210" />
                    </div>
                    {errors.phone && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.phone.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="password" className="label">Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('password')} type={showPassword ? 'text' : 'password'} id="password" className="input pl-11 pr-11" placeholder="Create a password" />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 transition-colors">
                        {showPassword ? <EyeOff className="w-5 h-5 shrink-0 pointer-events-none" /> : <Eye className="w-5 h-5 shrink-0 pointer-events-none" />}
                      </button>
                    </div>
                    {errors.password && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.password.message}</p>}
                  </div>
                  <div>
                    <label htmlFor="confirmPassword" className="label">Confirm Password</label>
                    <div className="relative">
                      <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('confirmPassword')} type="password" id="confirmPassword" className="input pl-11" placeholder="Confirm your password" />
                    </div>
                    {errors.confirmPassword && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.confirmPassword.message}</p>}
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(3)} className="btn-outline flex-1">
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>
                    <button type="button" onClick={handleNext} className="btn-gradient flex-1 group">
                      <span className="flex items-center justify-center gap-2">
                        Continue
                        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                      </span>
                    </button>
                  </div>
                </>
              )}

              {step === 5 && (
                <>
                  <div className="glass-card-sm p-5 space-y-4 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Account Type</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{accountType === 'PARTNER' ? 'Partner' : 'User'}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Name</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{watch('name') || '—'}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Email</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{watch('email') || '—'}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Gender</span>
                      <span className="font-semibold text-surface-900 dark:text-white">
                        {GENDERS.find(g => g.value === watch('gender'))?.label || '—'}
                      </span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Date of Birth</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{watch('dateOfBirth') || '—'}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Phone</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{watch('phone') || '—'}</span>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <input
                      {...register('terms')}
                      type="checkbox"
                      id="terms"
                      className="mt-0.5 h-4 w-4 rounded border-surface-300 text-primary-500 focus:ring-primary-500"
                    />
                    <label htmlFor="terms" className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                      I agree to the{' '}
                      <Link to="/terms" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Terms of Service</Link>
                      {' '}and{' '}
                      <Link to="/privacy" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Privacy Policy</Link>
                    </label>
                  </div>
                  {errors.terms && <p className="text-xs text-danger-500 font-medium">{errors.terms.message}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(4)} className="btn-outline flex-1">
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>
                    <button type="submit" disabled={loading} className="btn-gradient flex-1 group">
                      {loading ? (
                        <span className="flex items-center justify-center gap-2">
                          <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                          Creating...
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          Create Account
                          <Sparkles className="w-4 h-4" />
                        </span>
                      )}
                    </button>
                  </div>
                </>
              )}
            </form>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-sm text-surface-500 dark:text-surface-400">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-500 transition-colors">
              Sign in
            </Link>
          </p>
        </AnimatedPage>
      </div>
    </div>
  )
}

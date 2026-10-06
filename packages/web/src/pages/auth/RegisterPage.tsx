import { getErrorMessage, getErrorDetail } from '../../lib/error'
import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { User, Mail, Phone, Lock, Eye, EyeOff, ArrowRight, ArrowLeft, Check, Sparkles, Cake, KeyRound, ShieldCheck, RefreshCw, PersonStanding, UserRound, Users, Handshake } from 'lucide-react'
import { useAuth } from '../../lib/auth'
import { resolveLandingRole } from '../../lib/roles'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { stashPendingReferralCode } from '../../components/account/ReferralCard'

function ageFrom(dob: string): number {
  const birth = new Date(dob)
  if (isNaN(birth.getTime())) return -1
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

/**
 * Render a stored ISO date the way a person would read it. The date input
 * hands back "1995-03-12", which on the review step looked like a database
 * value rather than something the user had just typed.
 */
function formatDob(value?: string): string {
  if (!value) return '—'
  const parsed = new Date(value)
  if (isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Password strength, for feedback only. The server's floor is 6 characters and
 * that stays the rule; this exists so the user is told the truth about a weak
 * choice instead of discovering it somewhere else later.
 */
function scorePassword(value: string): { score: number; label: string; tone: string } {
  if (!value) return { score: 0, label: '', tone: '' }
  let score = 0
  if (value.length >= 8) score++
  if (value.length >= 12) score++
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++
  if (value.length < 6) score = 0
  const capped = Math.min(score, 4)
  if (capped <= 1) return { score: capped, label: 'Too weak', tone: 'bg-danger-500' }
  if (capped === 2) return { score: capped, label: 'Weak', tone: 'bg-danger-500' }
  if (capped === 3) return { score: capped, label: 'Good', tone: 'bg-amber-500' }
  return { score: capped, label: 'Strong', tone: 'bg-emerald-500' }
}

const GENDERS = [
  { value: 'MALE', label: 'Male', icon: PersonStanding },
  { value: 'FEMALE', label: 'Female', icon: UserRound },
  { value: 'OTHER', label: 'Other', icon: Users },
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

const REFERRAL_CODE = /^RB-[0-9A-F]{8}$/

/**
 * Reads the code carried by an invite link.
 *
 * The share button on the referral card emits /register?ref=RB-XXXXXXXX, and
 * nothing here used to read it - this was the only auth page that ignored its
 * query params - so every shared link opened an empty form and the friend had
 * to retype a code they had already tapped through to. The referral table
 * holding zero rows after shipping that button is the visible half of it.
 *
 * Only a code in the shape the server accepts is prefilled: a malformed link
 * presented as a valid code would fail at the end of signup, where the failure
 * reads as the user's typo rather than as the link's problem.
 */
function referralCodeFromSearch(params: URLSearchParams): string {
  const raw = (params.get('ref') ?? '').trim().toUpperCase()
  return REFERRAL_CODE.test(raw) ? raw : ''
}

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
    const role = resolveLandingRole(user)
    navigate(role === 'USER' ? '/profile/complete' : role === 'PARTNER' ? '/partner/dashboard' : '/admin/dashboard', { replace: true })
  }, [user, authLoading, navigate])

  const [searchParams] = useSearchParams()
  const referralFromLink = referralCodeFromSearch(searchParams)

  const { register, handleSubmit, watch, trigger, setValue, formState: { errors } } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    mode: 'onChange',
    // Set as a default rather than written in an effect so the value is in
    // place before the first render of step 2, rather than appearing a beat
    // after the user arrives on it.
    defaultValues: { referralCode: referralFromLink },
  })

  const emailValue = watch('email')
  const passwordValue = watch('password')
  const strength = scorePassword(passwordValue || '')

  // Steps are only reachable backwards once they have been passed. Without the
  // guard the indicator would let a jump skip the email proof, because step 2
  // is where verification happens.
  const furthestStep = useRef(1)
  useEffect(() => {
    if (step > furthestStep.current) furthestStep.current = step
  }, [step])
  const jumpTo = (target: number) => {
    if (target >= 1 && target < step && target <= furthestStep.current) setStep(target)
  }

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
        gender: data.gender,
        // Forward the real acceptance state. The auth client refuses to
        // register without it, so a submission that skipped the box is
        // rejected instead of being recorded as consent the user never gave.
        legalConsent: {
          accepted: data.terms === true,
          signatureValue: data.name,
        },
      })
      // If the user signed up with a valid referral code, link them as soon as
      // the account exists. The account is already created by this point, so a
      // failed apply must not fail registration. It used to be swallowed
      // outright, which made a typo'd or already-used code indistinguishable
      // from a working one - the user silently lost the reward. The code is now
      // parked so ReferralCard can offer a retry.
      if (isReferral) {
        const code = data.referralCode!.trim().toUpperCase()
        try {
          await api.post('/referrals/apply', { code })
          toast.success('Referral code applied!')
        } catch (err) {
          // ALREADY_REFERRED means this account already has a code, so a retry
          // would answer identically forever. Parking it would leave a banner
          // promising a retry that cannot succeed; only genuinely transient
          // failures earn one.
          if (getErrorDetail(err) === 'ALREADY_REFERRED') {
            toast('Your account has already used a referral code.', { icon: 'ℹ️', duration: 5000 })
          } else {
            stashPendingReferralCode(code)
            toast("You're signed up, but that referral code didn't apply — you can retry it from your profile.", {
              icon: '⚠️',
              duration: 6000,
            })
          }
        }
      }
      toast.success('Registration successful!')
      const userId = result?.userId || user?.id
      if (userId) {
        const emailVerified = result?.verification?.emailVerified === true
        if (emailVerified) {
          // Phone verification is switched off, so onboarding must not stop
          // for it. The number is saved unverified and the profile shows that
          // state; routing to /verify-mobile here would be a dead end.
          navigate('/profile/complete', { replace: true })
        } else {
          // Still ask for the email code — that verification is real and gates
          // KYC-gated features.
          navigate(
            `/verify-email?userId=${encodeURIComponent(userId)}&email=${encodeURIComponent(result?.email || data.email)}`,
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
        <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-primary-400/10 blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 h-[500px] w-[500px] rounded-full bg-primary-300/8 blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md m-auto">
        <AnimatedPage>
          {/* Logo */}
<div className="text-center mb-8">
            <div className="logo-3d mb-5">
              <img
                src="/logo-mark.svg"
                alt="Nabri logo"
                className="h-16 w-16 drop-shadow-[0_12px_28px_rgba(13,55,139,0.35)]"
              />
            </div>
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">Create account</h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">Join the Nabri community</p>
          </div>

          {/* Step indicators */}
          <div className="mb-6">
            <div className="flex items-center justify-between gap-2">
              {steps.map((s, i) => {
                const done = step > s.id
                const current = step === s.id
                const reachable = done && s.id <= furthestStep.current
                return (
                  <div key={s.id} className="flex items-center gap-2 flex-1 last:flex-none">
                    <button
                      type="button"
                      onClick={() => jumpTo(s.id)}
                      disabled={!reachable}
                      aria-current={current ? 'step' : undefined}
                      aria-label={`Step ${s.id}: ${s.title}`}
                      className={`flex items-center justify-center w-9 h-9 shrink-0 rounded-xl text-xs font-bold transition-all duration-500 ${
                        done
                          ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                          : current
                          ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-2 border-primary-400 dark:border-primary-500'
                          : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
                      } ${reachable ? 'cursor-pointer hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500' : 'cursor-default'}`}
                    >
                      {done ? <Check className="w-4 h-4" /> : s.id}
                    </button>
                    {i < steps.length - 1 && (
                      <div className={`flex-1 h-0.5 rounded-full transition-colors duration-500 ${
                        step > s.id ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'
                      }`} />
                    )}
                  </div>
                )
              })}
            </div>
            <p className="mt-3 text-xs font-medium uppercase tracking-wider text-surface-400">
              Step {step} of {steps.length}
            </p>
          </div>

          {/* Card */}
          <div className="prism-card prism-ring p-8">
            <div className="prism-sweep animate-prism-sweep" aria-hidden />
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
                      aria-pressed={accountType === 'USER'}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        accountType === 'USER'
                          ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
                          : 'border-surface-200 bg-white text-surface-700 hover:border-primary-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">I'm a User</div>
                          <div className="text-sm opacity-75">Book services, discover local help, and manage my account</div>
                        </div>
                        <div className={`flex items-center justify-center w-10 h-10 shrink-0 rounded-xl ${accountType === 'USER' ? 'bg-primary-500 text-white' : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'}`}>
                          <User className="w-5 h-5" />
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setAccountType('PARTNER')}
                      aria-pressed={accountType === 'PARTNER'}
                      className={`w-full rounded-2xl border p-4 text-left transition ${
                        accountType === 'PARTNER'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                          : 'border-surface-200 bg-white text-surface-700 hover:border-emerald-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-semibold">I'm a Partner</div>
                          <div className="text-sm opacity-75">Offer services, accept work, and get paid securely</div>
                        </div>
                        <div className={`flex items-center justify-center w-10 h-10 shrink-0 rounded-xl ${accountType === 'PARTNER' ? 'bg-emerald-500 text-white' : 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'}`}>
                          <Handshake className="w-5 h-5" />
                        </div>
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
                  {/* Optional, so it is set apart rather than sitting in the middle
                      of the required fields where it reads as mandatory. */}
                  <div className="rounded-2xl border border-dashed border-surface-200 dark:border-surface-700 p-4">
                    <label htmlFor="referralCode" className="label mb-0">
                      Referral code <span className="text-surface-400 font-normal">— optional</span>
                    </label>
                    <div className="relative mt-2">
                      <Sparkles className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 shrink-0 pointer-events-none text-surface-400" />
                      <input {...register('referralCode')} type="text" id="referralCode" className="input pl-11 uppercase" placeholder="RB-XXXXXXXX" />
                    </div>
                    <p className="mt-2 text-xs text-surface-500">Enter a friend's code to earn a sign-up reward on both sides.</p>
                  </div>
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1">
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

              {step === 3 && (
                <>
                  <div>
                    <label className="label">Gender</label>
                    <div className="grid grid-cols-3 gap-2">
                      {GENDERS.map((g) => {
                        const Icon = g.icon
                        const selected = watch('gender') === g.value
                        return (
                          <button
                            key={g.value}
                            type="button"
                            onClick={() => setValue('gender', g.value, { shouldValidate: true })}
                            aria-pressed={selected}
                            className={`rounded-xl border px-2 py-3 text-center transition ${
                              selected
                                ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-950/30 dark:text-primary-300'
                                : 'border-surface-200 bg-white text-surface-700 hover:border-primary-200 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-200'
                            }`}
                          >
                            <Icon className="w-5 h-5 mx-auto mb-1.5" />
                            <div className="text-xs font-semibold truncate">{g.label}</div>
                          </button>
                        )
                      })}
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
                    {passwordValue && (
                      <div className="mt-2.5 flex items-center gap-2.5">
                        <div className="flex-1 flex gap-1" aria-hidden="true">
                          {[1, 2, 3, 4].map((n) => (
                            <div
                              key={n}
                              className={`h-1 flex-1 rounded-full transition-colors ${
                                n <= strength.score ? strength.tone : 'bg-surface-200 dark:bg-surface-700'
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-xs font-semibold text-surface-500" role="status">{strength.label}</span>
                      </div>
                    )}
                    {!errors.password && !passwordValue && (
                      <p className="mt-2 text-xs text-surface-500">At least 6 characters. Longer and mixed is stronger.</p>
                    )}
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
                    <div className="flex justify-between items-center gap-4">
                      <span className="text-surface-500 shrink-0">Email</span>
                      <span className="font-semibold text-surface-900 dark:text-white text-right break-all">{watch('email') || '—'}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Gender</span>
                      <span className="font-semibold text-surface-900 dark:text-white">
                        {GENDERS.find(g => g.value === watch('gender'))?.label || '—'}
                      </span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center gap-4">
                      <span className="text-surface-500 shrink-0">Date of Birth</span>
                      <span className="font-semibold text-surface-900 dark:text-white text-right">{formatDob(watch('dateOfBirth'))}</span>
                    </div>
                    <div className="h-px bg-surface-200 dark:bg-surface-700" />
                    <div className="flex justify-between items-center">
                      <span className="text-surface-500">Phone</span>
                      <span className="font-semibold text-surface-900 dark:text-white">{watch('phone') || '—'}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-surface-200 dark:border-surface-700 p-4">
                    <div className="flex items-start gap-3">
                      <input
                        {...register('terms')}
                        type="checkbox"
                        id="terms"
                        className="mt-0.5 h-4 w-4 shrink-0 rounded border-surface-300 text-primary-500 focus:ring-primary-500"
                      />
                      <label htmlFor="terms" className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                        I agree to the{' '}
                        <Link to="/terms" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Terms of Service</Link>
                        {', '}
                        <Link to="/privacy" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Privacy Policy</Link>
                        {' '}and{' '}
                        <Link to="/legal/consent" className="font-semibold text-primary-600 dark:text-primary-400 hover:underline">Community Guidelines</Link>
                        {'. A dated copy of each is recorded and emailed to you.'}
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-2 border-t border-surface-200 dark:border-surface-700 pt-3">
                      <ShieldCheck className="w-4 h-4 text-surface-400 shrink-0" />
                      <p className="text-xs text-surface-500">
                        Signed as{' '}
                        <span className="font-semibold text-surface-700 dark:text-surface-200">{watch('name') || 'your typed name'}</span>
                      </p>
                    </div>
                    {errors.terms && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.terms.message}</p>}
                  </div>
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

import { getErrorMessage } from '../../lib/error'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, User } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

// Nabri is 18+ only. Nabri accepts people who are 18 years old — anyone under
// 18 is refused service, so the flow must stop at the very first step.
const MIN_AGE = 18

/**
 * Reduce typed input to the ten digits the backend expects.
 *
 * Deliberately duplicated rather than imported. The server is the authority for
 * what a valid number is (`services/phoneNumber.ts`), and the app has no way to
 * import from the backend package. This is an input aid only: the server still
 * re-validates and re-compares every submission, and if the two ever disagree
 * the server wins and nothing unsafe gets through.
 *
 * THE COUNTRY CODE RULE, AND WHY IT IS NOT SIMPLER
 * -------------------------------------------------
 * The field shows a `+91` prefix, so people will type `+91` anyway - it is the
 * reflex for an Indian phone number. Stripping non-digits alone is not enough:
 * `+917121156906` becomes `917121156906`, and truncating that to ten digits
 * yields `9171211569`, which is a DIFFERENT (and wrong) number. The user would
 * type their number correctly and be told it did not match their profile.
 *
 * So the `91` is treated as a country code - but ONLY once more than ten digits
 * have been entered. That condition is what keeps a genuine number that happens
 * to begin `91` intact:
 *
 *   9123456780   typed as-is  -> 9123456780   (ten digits: a local number)
 *   +91912345678 typed        -> 9123456780   (twelve: 91 is the code)
 *
 * A leading 0 (the Indian trunk prefix, `09820012345`) is dropped for the same
 * reason. The two rules cannot collide: one applies above ten digits with a `91`
 * prefix, the other at exactly eleven with a `0`.
 */
function toTenDigits(input: string): string {
  let digits = String(input ?? '').replace(/\D/g, '')
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits.slice(0, 10)
}

function ageFromDob(dob: string): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const monthDiff = today.getMonth() - birth.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1
  return age
}

export function KycStep1PersonalDetails() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [savedLoadError, setSavedLoadError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const edited = useRef(false)
  const submissionLock = useRef(false)
  const [formData, setFormData] = useState(() => ({
    fullName: user?.fullName || user?.name || '',
    dateOfBirth: user?.dateOfBirth?.slice(0, 10) || '',
    gender: user?.gender || '',
    city: user?.city || '',
    country: user?.country || 'India',
    address: '',
    // Pre-filled from the account, so the common case needs no typing at all.
    phone: toTenDigits(user?.phone ?? ''),
  }))

  useEffect(() => {
    const controller = new AbortController()
    setLoadingSaved(true)
    setSavedLoadError(false)
    api.get('/verification/status', { signal: controller.signal, timeout: 15000 })
      .then((response) => {
        if (edited.current) return
        const status = response.data?.data || response.data
        const details = status?.personalDetailsData
        if (!details) return
        setFormData((current) => ({
          ...current,
          fullName: details.fullName || current.fullName,
          dateOfBirth: details.dateOfBirth?.slice(0, 10) || current.dateOfBirth,
          gender: details.gender || current.gender,
          city: details.city || current.city,
          country: details.country || current.country,
          address: details.address || current.address,
        }))
      })
      .catch(() => {
        if (!controller.signal.aborted) setSavedLoadError(true)
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSaved(false)
      })
    return () => controller.abort()
  }, [loadAttempt])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    edited.current = true
    // Reduced as the user types, so a pasted or typed `+91 98765 43210` collapses
    // to the ten digits the server expects. See toTenDigits for why the country
    // code cannot simply be stripped.
    const nextValue = name === 'phone' ? toTenDigits(value) : value
    setFormData(prev => ({ ...prev, [name]: nextValue }))
  }

  const age = ageFromDob(formData.dateOfBirth)
  const underage = age !== null && age < MIN_AGE

  /**
   * Why the phone field is not acceptable, or null when it is.
   *
   * The rules mirror the server's, and deliberately stop where the server's stop:
   * this validates SHAPE only. It does not try to detect sample numbers like
   * 9999999999, because a browser-side guess at that would either let one
   * through to the server or block a legitimate number, and the server already
   * handles it correctly with a clear message.
   */
  const phoneProblem: string | null = (() => {
    const value = formData.phone.trim()
    if (!value) return 'Enter your 10-digit mobile number'
    if (!/^\d{10}$/.test(value)) return 'Your mobile number must be exactly 10 digits'
    if (!/^[6-9]/.test(value)) return 'Indian mobile numbers start with 6, 7, 8 or 9'
    return null
  })()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.fullName || !formData.dateOfBirth || !formData.gender) {
      toast.error('Please fill all required fields')
      return
    }
    if (ageFromDob(formData.dateOfBirth) === null) {
      toast.error('Please enter a valid date of birth')
      return
    }
    // Hard stop: 18+ only, no proceeding to the next step.
    if (underage) {
      toast.error(`You must be at least ${MIN_AGE} years old to use Nabri`)
      return
    }
    // Checked here purely to save a round trip. The server compares this against
    // the number on the account and refuses a mismatch regardless of what the
    // browser thought.
    if (phoneProblem) {
      toast.error(phoneProblem)
      return
    }
    if (submissionLock.current) return

    submissionLock.current = true
    setLoading(true)
    try {
      await api.post('/verification/personal-details', formData)
      toast.success('Personal details saved')
      navigate('/verification/step2')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save personal details'))
    } finally {
      submissionLock.current = false
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/verification')} className="p-2 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Personal Details</h1>
            <p className="text-sm text-surface-500">Step 1 of 7</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/10 to-accent-500/10 p-6 border border-primary-200 dark:border-primary-800">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center flex-shrink-0">
              <User className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            </div>
            <div>
              <h2 className="font-bold text-surface-900 dark:text-white">Tell us about yourself</h2>
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                We need your basic information to verify your identity. All information is securely stored and encrypted.
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          {loadingSaved && <p role="status" className="mb-4 text-sm text-surface-500">Loading saved personal details…</p>}
          {savedLoadError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-900/20 dark:text-danger-300">
              <span>Saved details could not be loaded. You can continue, or retry before editing.</span>
              <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)} className="font-semibold underline underline-offset-2">Retry</button>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="fullName"
                value={formData.fullName}
                onChange={handleChange}
                placeholder="John Doe"
                className="input w-full"
                required
              />
              <p className="text-xs text-surface-500 mt-1">As it appears on your government ID</p>
            </div>

            {/* Date of Birth */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Date of Birth <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="dateOfBirth"
                value={formData.dateOfBirth}
                onChange={handleChange}
                className="input w-full"
                required
                aria-invalid={underage || undefined}
                aria-describedby="dob-hint"
              />
              <p id="dob-hint" className={`text-xs mt-1 ${underage ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-surface-500'}`}>
                {underage
                  ? `You entered ${age} — you must be at least ${MIN_AGE} years old to use Nabri. You cannot continue.`
                  : `You must be at least ${MIN_AGE} years old to use Nabri.`}
              </p>
            </div>

            {/* Mobile Number — must match the number on the account */}
            <div>
              <label htmlFor="kyc-phone" className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Mobile Number <span className="text-red-500">*</span>
              </label>
              <div className="flex items-stretch">
                <span
                  className="inline-flex items-center rounded-l-xl border border-r-0 border-surface-300 bg-surface-100 px-3 text-sm font-medium text-surface-600 dark:border-surface-700 dark:bg-surface-800 dark:text-surface-400"
                  aria-hidden="true"
                >
                  +91
                </span>
                <input
                  id="kyc-phone"
                  type="tel"
                  name="phone"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={20}
                  value={formData.phone}
                  onChange={handleChange}
                  placeholder="9876543210"
                  className="input w-full rounded-l-none"
                  required
                  aria-invalid={Boolean(phoneProblem) || undefined}
                  aria-describedby="phone-hint"
                />
              </div>
              <p
                id="phone-hint"
                className={`text-xs mt-1 ${phoneProblem ? 'text-danger-600 dark:text-danger-400 font-medium' : 'text-surface-500'}`}
              >
                {phoneProblem ?? 'Your 10-digit number. The +91 above is added for you — it must match the number on your profile.'}
              </p>
            </div>

            {/* Gender */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Gender <span className="text-red-500">*</span>
              </label>
              <select
                name="gender"
                value={formData.gender}
                onChange={handleChange}
                className="input w-full"
                required
              >
                <option value="">Select Gender</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            {/* Address */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Address
              </label>
              <textarea
                name="address"
                value={formData.address}
                onChange={handleChange}
                placeholder="Your complete address"
                rows={3}
                className="input w-full"
              />
            </div>

            {/* City */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                City
              </label>
              <input
                type="text"
                name="city"
                value={formData.city}
                onChange={handleChange}
                placeholder="Mumbai"
                className="input w-full"
              />
            </div>

            {/* Country */}
            <div>
              <label className="block text-sm font-medium text-surface-900 dark:text-white mb-2">
                Country
              </label>
              <input
                type="text"
                name="country"
                value={formData.country}
                onChange={handleChange}
                disabled
                className="input w-full opacity-60 cursor-not-allowed"
              />
            </div>

            {/* Submit Button */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={() => navigate('/verification')}
                className="flex-1 btn-secondary"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={loading || underage}
                className="flex-1 btn-primary flex items-center justify-center gap-2"
              >
                {loading ? '...' : underage ? `${MIN_AGE}+ required` : <>Next <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>
          </form>
        </GlassCard>
      </AnimatedPage>

      {/* Help Section */}
      <AnimatedPage delay={150}>
        <GlassCard variant="elevated" padding="lg" className="bg-surface-50 dark:bg-surface-800/50">
          <h3 className="font-bold text-surface-900 dark:text-white mb-3">Need help?</h3>
          <ul className="space-y-2 text-sm text-surface-600 dark:text-surface-400">
            <li>• Information must match your government-issued ID</li>
            <li>• Date of birth should be in YYYY-MM-DD format</li>
            <li>• Address will be used for verification documents</li>
            <li>• You can update this information later if needed</li>
          </ul>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

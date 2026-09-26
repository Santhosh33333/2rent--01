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
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const age = ageFromDob(formData.dateOfBirth)
  const underage = age !== null && age < MIN_AGE

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

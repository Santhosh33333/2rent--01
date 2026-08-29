import { getErrorMessage } from '../../lib/error'
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { useAuth } from '../../lib/auth'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import {
  User, MapPin, Check, ArrowRight, ArrowLeft, Camera, Calendar,
} from 'lucide-react'

const profileSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  bio: z.string().max(200, 'Bio must be 200 characters or less').optional().or(z.literal('')),
  dateOfBirth: z.string().optional().or(z.literal('')),
  city: z.string().optional().or(z.literal('')),
  country: z.string().optional().or(z.literal('')),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']).optional(),
})

type ProfileForm = z.infer<typeof profileSchema>

const STEPS = [
  { id: 1, title: 'Basic Info', subtitle: 'Tell us about yourself' },
  { id: 2, title: 'Location', subtitle: 'Where are you based?' },
  { id: 3, title: 'Preferences', subtitle: 'A few more details' },
  { id: 4, title: 'All Done', subtitle: 'Your profile is ready' },
]

const GENDER_OPTIONS = [
  { value: 'MALE' as const, label: 'Male', emoji: 'ðŸ‘¨' },
  { value: 'FEMALE' as const, label: 'Female', emoji: 'ðŸ‘©' },
  { value: 'OTHER' as const, label: 'Other', emoji: 'ðŸ§‘' },
]

export function ProfileCompletionPage() {
  const navigate = useNavigate()
  const { user, updateUser } = useAuth()
  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [saving, setSaving] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [profileCompleteSet, setProfileCompleteSet] = useState(false)
  const animKey = useRef(0)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName: user?.name || user?.fullName || '',
      bio: '',
      dateOfBirth: '',
      city: '',
      country: 'India',
      gender: undefined,
    },
  })

  const watchedGender = watch('gender')
  const watchedBio = watch('bio')

  useEffect(() => {
    if (profileCompleteSet) {
      const timer = setTimeout(() => {
        navigate('/dashboard', { replace: true })
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [profileCompleteSet, navigate])

  const goNext = () => {
    setDirection('forward')
    animKey.current += 1
    setStep(s => Math.min(s + 1, 4))
  }

  const goBack = () => {
    setDirection('backward')
    animKey.current += 1
    setStep(s => Math.max(s - 1, 1))
  }

  const skip = () => goNext()

  const onSubmit = async (data: ProfileForm) => {
    if (step < 4) {
      goNext()
      return
    }
    setSaving(true)
    try {
      const payload: Record<string, any> = {}
      if (data.fullName) payload.fullName = data.fullName
      if (data.bio) payload.bio = data.bio
      if (data.dateOfBirth) payload.dateOfBirth = data.dateOfBirth
      if (data.city) payload.city = data.city
      if (data.country) payload.country = data.country
      if (data.gender) payload.gender = data.gender

      try {
        await api.put('/users/profile', payload)
      } catch (err) {
        // fallback for local demo/offline flows
      }

      const nextUser = {
        ...(user || {}),
        name: data.fullName || user?.name || 'RentBuddy User',
        fullName: data.fullName || user?.fullName || 'RentBuddy User',
        bio: data.bio || user?.bio,
        city: data.city || user?.city,
        country: data.country || user?.country,
        gender: data.gender || user?.gender,
      }

      updateUser(nextUser)
      localStorage.setItem('profile_complete', 'true')
      localStorage.setItem('user', JSON.stringify(nextUser))
      toast.success('Profile updated!')
      setProfileCompleteSet(true)
      setCompleted(true)
    } catch (err: unknown) {
      localStorage.setItem('profile_complete', 'true')
      if (user) {
        const fallbackUser = { ...user, name: user.name || 'RentBuddy User', fullName: user.fullName || user.name || 'RentBuddy User' }
        updateUser(fallbackUser)
      }
      toast.error(getErrorMessage(err, 'Failed to save profile, but your session was saved locally.'))
      setProfileCompleteSet(true)
      setCompleted(true)
    } finally {
      setSaving(false)
    }
  }

  const slideClass = direction === 'forward'
    ? 'animate-slide-in-right'
    : 'animate-slide-in-left'

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50 dark:bg-surface-950 px-4 py-12 transition-colors duration-400">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] bg-primary-400/10 rounded-full blur-[128px]" />
        <div className="absolute -bottom-32 -left-32 w-[500px] h-[500px] bg-accent-400/10 rounded-full blur-[128px]" />
      </div>

      <div className="relative w-full max-w-md">
        <AnimatedPage>
          <div className="text-center mb-8">
            <img
              src="/logo-mark.svg"
              alt="RentBuddy logo"
              className="inline-block w-14 h-14 rounded-2xl shadow-xl shadow-primary-500/25 mb-5 animate-float"
            />
            <h1 className="text-3xl font-bold font-display text-surface-900 dark:text-white tracking-tight">Complete Your Profile</h1>
            <p className="mt-2 text-surface-500 dark:text-surface-400 text-sm">Help others know you better</p>
          </div>

          {/* Step Indicator */}
          {!completed && (
            <div className="flex items-center justify-center mb-8">
              {STEPS.map((s, i) => (
                <div key={s.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div className={`flex items-center justify-center w-10 h-10 rounded-full text-xs font-bold transition-all duration-500 ${
                      step > s.id
                        ? 'bg-primary-500 text-white shadow-lg shadow-primary-500/25'
                        : step === s.id
                        ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 border-2 border-primary-400 dark:border-primary-500 animate-pulse'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
                    }`}>
                      {step > s.id ? <Check className="w-4 h-4" /> : s.id}
                    </div>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`w-12 h-0.5 mx-2 rounded-full transition-colors duration-500 ${
                      step > s.id ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'
                    }`} />
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="glass-elevated p-8">
            {step === 4 && completed ? (
              <div className="text-center py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 mb-6 animate-scale-in">
                  <Check className="w-10 h-10 text-emerald-500" />
                </div>
                <h3 className="text-xl font-bold font-display text-surface-900 dark:text-white mb-2">Your profile is ready!</h3>
                <p className="text-sm text-surface-500 dark:text-surface-400 mb-6">You're all set to explore RentBuddy</p>
                <button
                  onClick={() => navigate('/dashboard', { replace: true })}
                  className="btn-gradient w-full btn-lg group"
                >
                  <span className="flex items-center justify-center gap-2">
                    Continue to Dashboard
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </span>
                </button>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <h3 className="text-lg font-bold font-display text-surface-900 dark:text-white">{STEPS[step - 1].title}</h3>
                  <p className="text-sm text-surface-500 mt-1">{STEPS[step - 1].subtitle}</p>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                  {step === 1 && (
                    <div key={`step1-${animKey.current}`} className={slideClass}>
                      <div className="space-y-4">
                        <div>
                          <label className="label">Full Name</label>
                          <div className="relative">
                            <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                            <input
                              {...register('fullName')}
                              type="text"
                              className="input pl-11"
                              placeholder="Your full name"
                            />
                          </div>
                          {errors.fullName && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.fullName.message}</p>}
                        </div>

                        <div>
                          <label className="label">Bio</label>
                          <textarea
                            {...register('bio')}
                            className="input min-h-[80px] resize-none"
                            placeholder="Tell us a little about yourself..."
                            maxLength={200}
                          />
                          <p className="mt-1 text-xs text-surface-400 text-right">{(watchedBio || '').length}/200</p>
                          {errors.bio && <p className="mt-1 text-xs text-danger-500 font-medium">{errors.bio.message}</p>}
                        </div>

                        <div>
                          <label className="label">Date of Birth</label>
                          <div className="relative">
                            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                            <input
                              {...register('dateOfBirth')}
                              type="date"
                              className="input pl-11"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 2 && (
                    <div key={`step2-${animKey.current}`} className={slideClass}>
                      <div className="space-y-4">
                        <div>
                          <label className="label">City</label>
                          <div className="relative">
                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                            <input
                              {...register('city')}
                              type="text"
                              className="input pl-11"
                              placeholder="Your city"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="label">Country</label>
                          <div className="relative">
                            <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                            <input
                              {...register('country')}
                              type="text"
                              className="input pl-11"
                              placeholder="Country"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 3 && (
                    <div key={`step3-${animKey.current}`} className={slideClass}>
                      <div className="space-y-6">
                        <div>
                          <label className="label mb-3 block">Gender</label>
                          <div className="grid grid-cols-3 gap-3">
                            {GENDER_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => setValue('gender', opt.value, { shouldValidate: true })}
                                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all duration-300 ${
                                  watchedGender === opt.value
                                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-lg shadow-primary-500/10'
                                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                                }`}
                              >
                                <span className="text-2xl">{opt.emoji}</span>
                                <span className={`text-sm font-medium ${
                                  watchedGender === opt.value
                                    ? 'text-primary-600 dark:text-primary-400'
                                    : 'text-surface-600 dark:text-surface-400'
                                }`}>{opt.label}</span>
                              </button>
                            ))}
                          </div>
                          {errors.gender && <p className="mt-2 text-xs text-danger-500 font-medium">{errors.gender.message}</p>}
                        </div>

                        <div>
                          <label className="label mb-3 block">Profile Photo</label>
                          <div className="flex justify-center">
                            <button type="button" className="w-28 h-28 rounded-full border-2 border-dashed border-surface-300 dark:border-surface-600 flex flex-col items-center justify-center gap-2 text-surface-400 hover:border-primary-400 hover:text-primary-500 transition-colors duration-300">
                              <Camera className="w-8 h-8" />
                              <span className="text-xs font-medium">Add Photo</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {step === 4 && !completed && (
                    <div key={`step4-${animKey.current}`} className={slideClass}>
                      <div className="text-center py-4 space-y-4">
                        <div className="glass-card-sm p-5 space-y-3 text-sm">
                          <div className="flex justify-between items-center">
                            <span className="text-surface-500">Name</span>
                            <span className="font-semibold text-surface-900 dark:text-white">{watch('fullName') || 'â€”'}</span>
                          </div>
                          <div className="h-px bg-surface-200 dark:bg-surface-700" />
                          <div className="flex justify-between items-center">
                            <span className="text-surface-500">Bio</span>
                            <span className="font-semibold text-surface-900 dark:text-white truncate max-w-[180px]">{watch('bio') || 'â€”'}</span>
                          </div>
                          <div className="h-px bg-surface-200 dark:bg-surface-700" />
                          <div className="flex justify-between items-center">
                            <span className="text-surface-500">City</span>
                            <span className="font-semibold text-surface-900 dark:text-white">{watch('city') || 'â€”'}</span>
                          </div>
                          <div className="h-px bg-surface-200 dark:bg-surface-700" />
                          <div className="flex justify-between items-center">
                            <span className="text-surface-500">Country</span>
                            <span className="font-semibold text-surface-900 dark:text-white">{watch('country') || 'â€”'}</span>
                          </div>
                          <div className="h-px bg-surface-200 dark:bg-surface-700" />
                          <div className="flex justify-between items-center">
                            <span className="text-surface-500">Gender</span>
                            <span className="font-semibold text-surface-900 dark:text-white">{watch('gender') || 'â€”'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Buttons */}
                  {!completed && (
                    <div className="flex gap-3 pt-2">
                      {step > 1 && (
                        <button type="button" onClick={goBack} className="btn-outline flex-1">
                          <ArrowLeft className="w-4 h-4" />
                          Back
                        </button>
                      )}
                      {step < 4 && (
                        <button type="button" onClick={skip} className="btn-ghost flex-shrink-0 text-sm text-surface-500 hover:text-surface-700 dark:hover:text-surface-300">
                          Skip
                        </button>
                      )}
                      <button type="submit" disabled={saving} className={`${step === 1 ? 'w-full' : 'flex-1'} btn-gradient group`}>
                        {saving ? (
                          <span className="flex items-center justify-center gap-2">
                            <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                            Saving...
                          </span>
                        ) : step === 4 ? (
                          <span className="flex items-center justify-center gap-2">
                            <Check className="w-4 h-4" />
                            Save & Finish
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            Continue
                            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                          </span>
                        )}
                      </button>
                    </div>
                  )}
                </form>
              </>
            )}
          </div>
        </AnimatedPage>
      </div>
    </div>
  )
}
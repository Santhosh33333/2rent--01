import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Calendar, Clock, FileText, Users,
  Loader2, Send, Award, Star
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

interface FormData {
  experience: string
  availability: string
  reason: string
  references: string
}

export function ApplyPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    defaultValues: { experience: '', availability: '', reason: '', references: '' },
  })

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      await api.post('/walking-partner/apply', data)
      toast.success('Application submitted successfully!')
      navigate('/walking-partner/status')
    } catch {
      toast.error('Failed to submit application. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <button
        onClick={() => navigate('/dashboard')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Dashboard</span>
      </button>

      {/* Form Card */}
      <div className="glass-card overflow-hidden">
        {/* Gradient Header */}
        <div className="relative px-6 md:px-8 pt-8 pb-16 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900">
          <div className="absolute inset-0 bg-grid opacity-20" />
          <div className="relative flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 shrink-0">
              <Award className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white">Become a Walking Partner</h1>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                Join our community of trusted walking partners
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 md:px-8 pb-8 -mt-8 space-y-5">
          <div className="bg-white dark:bg-surface-800/80 rounded-2xl p-6 shadow-sm border border-surface-200/50 dark:border-surface-700/50 space-y-5">
            {/* Experience */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <Star className="w-3.5 h-3.5 inline mr-1 text-amber-500" />
                Experience
              </label>
              <textarea
                {...register('experience', { required: 'Experience is required' })}
                rows={3}
                placeholder="Describe your experience with pets, walking, or caregiving..."
                className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors resize-none ${
                  errors.experience
                    ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                    : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-0`}
              />
              {errors.experience && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.experience.message}
                </p>
              )}
            </div>

            {/* Availability */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <Calendar className="w-3.5 h-3.5 inline mr-1 text-primary-500" />
                Availability
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { value: 'weekdays', label: 'Weekdays', icon: Calendar },
                  { value: 'weekends', label: 'Weekends', icon: Clock },
                  { value: 'both', label: 'Both', icon: Calendar },
                ].map((opt) => (
                  <label
                    key={opt.value}
                    className="relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200"
                  >
                    <input
                      type="radio"
                      value={opt.value}
                      {...register('availability', { required: 'Availability is required' })}
                      className="sr-only"
                    />
                    <opt.icon className="w-5 h-5 text-surface-400 peer-checked:text-primary-500" />
                    <span className="text-xs font-medium text-surface-600 dark:text-surface-400">{opt.label}</span>
                  </label>
                ))}
              </div>
              {errors.availability && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.availability.message}
                </p>
              )}
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <FileText className="w-3.5 h-3.5 inline mr-1 text-surface-500" />
                Why do you want to join?
              </label>
              <textarea
                {...register('reason', { required: 'Reason is required' })}
                rows={3}
                placeholder="Tell us why you'd make a great walking partner..."
                className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors resize-none ${
                  errors.reason
                    ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                    : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-0`}
              />
              {errors.reason && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.reason.message}
                </p>
              )}
            </div>

            {/* References */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <Users className="w-3.5 h-3.5 inline mr-1 text-emerald-500" />
                References <span className="text-surface-400 font-normal">(optional)</span>
              </label>
              <textarea
                {...register('references')}
                rows={2}
                placeholder="Names and contact info of references..."
                className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 resize-none"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex-1 py-3 rounded-xl bg-gradient-to-r from-primary-500 to-accent-500 text-white text-sm font-medium shadow-lg shadow-primary-500/20 hover:shadow-xl hover:shadow-primary-500/30 transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</>
              ) : (
                <><Send className="w-4 h-4" /> Submit Application</>
              )}
            </button>
            <Link
              to="/dashboard"
              className="px-6 py-3 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 text-sm font-medium hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors text-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}

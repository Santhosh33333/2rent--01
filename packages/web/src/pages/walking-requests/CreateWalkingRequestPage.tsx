import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, Dog, Heart, MapPin, Calendar, Clock,
  DollarSign, FileText, Loader2, Send, Sparkles
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'

interface FormData {
  type: 'walking' | 'companionship'
  location: string
  date: string
  time: string
  reward: number
  description: string
}

export function CreateWalkingRequestPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const { register, handleSubmit, formState: { errors }, watch } = useForm<FormData>({
    defaultValues: { type: 'walking', location: '', date: '', time: '', reward: undefined, description: '' },
  })

  const selectedType = watch('type')

  const onSubmit = async (data: FormData) => {
    setLoading(true)
    try {
      await api.post('/walking-requests', data)
      toast.success('Walking request created successfully!')
      navigate('/walking-requests')
    } catch {
      toast.error('Failed to create request. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeInUp">
      {/* Back Button */}
      <button
        onClick={() => navigate('/walking-requests')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
        <span className="text-sm">Back to Requests</span>
      </button>

      {/* Form Card */}
      <div className="glass-card overflow-hidden">
        {/* Gradient Header */}
        <div className="relative px-6 md:px-8 pt-8 pb-16 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900">
          <div className="absolute inset-0 bg-grid opacity-20" />
          <div className="relative flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 shrink-0">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-surface-900 dark:text-white">New Request</h1>
              <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
                Create a walking or companionship request
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit(onSubmit)} className="px-6 md:px-8 pb-8 -mt-8 space-y-5">
          <div className="bg-white dark:bg-surface-800/80 rounded-2xl p-6 shadow-sm border border-surface-200/50 dark:border-surface-700/50 space-y-5">
            {/* Type Selector */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                Request Type
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={`relative flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                  selectedType === 'walking'
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 shadow-sm'
                    : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:border-surface-300 dark:hover:border-surface-600'
                }`}>
                  <input type="radio" value="walking" {...register('type')} className="sr-only" />
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    selectedType === 'walking'
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-100 dark:bg-surface-700 text-surface-500'
                  }`}>
                    <Dog className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Walking</p>
                    <p className="text-xs text-surface-500">Walk with a partner</p>
                  </div>
                  {selectedType === 'walking' && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </label>
                <label className={`relative flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-200 ${
                  selectedType === 'companionship'
                    ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20 shadow-sm'
                    : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 hover:border-surface-300 dark:hover:border-surface-600'
                }`}>
                  <input type="radio" value="companionship" {...register('type')} className="sr-only" />
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    selectedType === 'companionship'
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-100 dark:bg-surface-700 text-surface-500'
                  }`}>
                    <Heart className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-surface-900 dark:text-white">Companionship</p>
                    <p className="text-xs text-surface-500">Social meetup</p>
                  </div>
                  {selectedType === 'companionship' && (
                    <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent-500 flex items-center justify-center">
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                    </div>
                  )}
                </label>
              </div>
            </div>

            {/* Location */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <MapPin className="w-3.5 h-3.5 inline mr-1 text-emerald-500" />
                Location
              </label>
              <input
                {...register('location', { required: 'Location is required' })}
                placeholder="e.g. Central Park, New York"
                className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors ${
                  errors.location
                    ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                    : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-0`}
              />
              {errors.location && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.location.message}
                </p>
              )}
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  <Calendar className="w-3.5 h-3.5 inline mr-1 text-primary-500" />
                  Date
                </label>
                <input
                  type="date"
                  {...register('date', { required: 'Date is required' })}
                  className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white transition-colors ${
                    errors.date
                      ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                      : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                  } focus:outline-none focus:ring-2 focus:ring-offset-0`}
                />
                {errors.date && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                    {errors.date.message}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                  <Clock className="w-3.5 h-3.5 inline mr-1 text-accent-500" />
                  Time
                </label>
                <input
                  type="time"
                  {...register('time', { required: 'Time is required' })}
                  className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white transition-colors ${
                    errors.time
                      ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                      : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                  } focus:outline-none focus:ring-2 focus:ring-offset-0`}
                />
                {errors.time && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                    {errors.time.message}
                  </p>
                )}
              </div>
            </div>

            {/* Reward */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <DollarSign className="w-3.5 h-3.5 inline mr-1 text-violet-500" />
                Reward
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm font-medium">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="5"
                  placeholder="25.00"
                  {...register('reward', {
                    required: 'Reward is required',
                    min: { value: 5, message: 'Minimum reward is ₹5' },
                    valueAsNumber: true,
                  })}
                  className={`w-full pl-8 pr-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors ${
                    errors.reward
                      ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                      : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                  } focus:outline-none focus:ring-2 focus:ring-offset-0`}
                />
              </div>
              {errors.reward && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.reward.message}
                </p>
              )}
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <FileText className="w-3.5 h-3.5 inline mr-1 text-surface-500" />
                Description
              </label>
              <textarea
                {...register('description')}
                rows={3}
                placeholder="Describe your request — what kind of walk or companionship are you looking for?"
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
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</>
              ) : (
                <><Send className="w-4 h-4" /> Create Request</>
              )}
            </button>
            <Link
              to="/walking-requests"
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

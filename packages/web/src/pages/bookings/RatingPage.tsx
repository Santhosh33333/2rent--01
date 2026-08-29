import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Star, MessageSquare, Clock, ThumbsUp, Sparkles, Loader2, CheckCircle, ArrowLeft
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

export function RatingPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [rating, setRating] = useState(0)
  const [hoveredStar, setHoveredStar] = useState(0)
  const [review, setReview] = useState('')
  const [punctuality, setPunctuality] = useState(0)
  const [behavior, setBehavior] = useState(0)
  const [serviceQuality, setServiceQuality] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (!id || rating === 0) {
      toast.error('Please select a rating')
      return
    }
    setSubmitting(true)
    try {
      await api.post(`/bookings/${id}/rate`, {
        rating,
        review,
        categories: {
          punctuality,
          behavior,
          serviceQuality,
        },
      })
      setSubmitted(true)
      toast.success('Rating submitted!')
    } catch {
      toast.error('Failed to submit rating')
    } finally {
      setSubmitting(false)
    }
  }

  const categoryRatings = [
    { label: 'Punctuality', value: punctuality, set: setPunctuality, icon: Clock },
    { label: 'Behavior', value: behavior, set: setBehavior, icon: ThumbsUp },
    { label: 'Service Quality', value: serviceQuality, set: setServiceQuality, icon: Sparkles },
  ]

  if (submitted) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <AnimatedPage>
          <div className="text-center max-w-sm mx-auto">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mb-6 shadow-xl shadow-amber-500/30">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-2">Thank You!</h1>
            <p className="text-surface-500 dark:text-surface-400 mb-8">Your feedback helps us improve. Rating: {'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</p>
            <button onClick={() => navigate('/bookings')} className="w-full btn-primary">
              Back to Bookings
            </button>
          </div>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-lg mx-auto">
      <AnimatedPage>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Rate Your Experience</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm">How was your service?</p>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg" className="text-center">
          <p className="text-sm text-surface-500 mb-6">Tap a star to rate</p>
          <div className="flex items-center justify-center gap-2 mb-4">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                onMouseEnter={() => setHoveredStar(star)}
                onMouseLeave={() => setHoveredStar(0)}
                onClick={() => setRating(star)}
                className="transition-transform hover:scale-125 active:scale-95"
              >
                <Star
                  className={`w-12 h-12 transition-colors ${
                    star <= (hoveredStar || rating)
                      ? 'fill-amber-400 text-amber-400'
                      : 'text-surface-300 dark:text-surface-600'
                  }`}
                />
              </button>
            ))}
          </div>
          {rating > 0 && (
            <p className="text-sm font-medium text-surface-600 dark:text-surface-400">
              {rating === 1 ? 'Poor' : rating === 2 ? 'Fair' : rating === 3 ? 'Good' : rating === 4 ? 'Very Good' : 'Excellent'}
            </p>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={200}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-4">Category Ratings</h3>
          <div className="space-y-4">
            {categoryRatings.map((cat) => (
              <div key={cat.label}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-surface-700 dark:text-surface-300 flex items-center gap-2">
                    <cat.icon className="w-4 h-4 text-surface-400" />
                    {cat.label}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => cat.set(star)}
                      className="transition-transform hover:scale-110"
                    >
                      <Star
                        className={`w-8 h-8 transition-colors ${
                          star <= cat.value
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-surface-300 dark:text-surface-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={300}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary-500" />
            Written Review
          </h3>
          <textarea
            value={review}
            onChange={(e) => setReview(e.target.value)}
            placeholder="Share your experience..."
            rows={4}
            className="input resize-none py-3"
          />
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={400}>
        <button
          onClick={handleSubmit}
          disabled={submitting || rating === 0}
          className="w-full btn-gradient py-4 text-base flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {submitting ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" /> Submitting...
            </>
          ) : (
            <>
              <Star className="w-5 h-5" /> Submit Rating
            </>
          )}
        </button>
      </AnimatedPage>
    </div>
  )
}

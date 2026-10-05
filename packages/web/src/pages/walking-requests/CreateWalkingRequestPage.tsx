import { useEffect, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft, MapPin, Calendar, Clock, Timer,
  IndianRupee, FileText, Loader2, Send, Sparkles
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'
import { LocationInput } from '../../components/LocationInput'

/**
 * Field names here mirror POST /walking-requests exactly.
 *
 * This form previously posted { type, location, date, time, reward, description }
 * against an endpoint that reads { startLocation, endLocation, startTime,
 * durationMinutes, notes, fare }. Two of those columns are non-nullable and
 * startTime went through `new Date(undefined)`, so Prisma threw on every submit
 * and the user got a bare 500 "Failed to create walking request" — the page
 * rendered perfectly, which is why a route sweep never caught it. Renaming the
 * fields is the fix; keeping them in step with the controller is the discipline.
 */
interface FormData {
  startLocation: string
  endLocation: string
  date: string
  time: string
  durationMinutes: number
  notes: string
  /** Optional override. Empty means "use the standard rate". */
  fare?: number
}

interface Estimate {
  finalAmount: number
  partnerEarning: number
}

/** Mirrors resolveWalkingFare's band: a client fare must sit inside [50%, 200%]. */
const FARE_BAND_MIN = 0.5
const FARE_BAND_MAX = 2

const money = (n: number) => `\u20b9${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function CreateWalkingRequestPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const submissionLock = useRef(false)
  const { register, handleSubmit, formState: { errors }, watch, setError, clearErrors, setValue } = useForm<FormData>({
    defaultValues: {
      startLocation: '', endLocation: '', date: '', time: '',
      durationMinutes: 30, notes: '', fare: undefined,
    },
  })

  // Registered for their validation rules only - the inputs are rendered by
  // LocationInput below, which is a controlled component fed by watch(). Nothing
  // attaches the returned ref, and that is deliberate: RHF still validates these
  // values on submit, because registration is what puts them in the form.
  register('startLocation', {
    required: 'Meeting point is required',
    validate: (v) => v.trim().length > 0 || 'Meeting point is required',
  })
  register('endLocation', {
    required: 'Destination is required',
    validate: (v) => v.trim().length > 0 || 'Destination is required',
  })
  const startLocation = watch('startLocation')
  const endLocation = watch('endLocation')

  /**
   * Duration is the one field with a custom onChange (range feedback while
   * typing), so its registration is held separately instead of being spread
   * inline.
   *
   * Spreading {...register('durationMinutes', ...)} and then writing onChange=
   * after it discards react-hook-form's own handler: the value never reaches
   * form state, so watch() keeps returning the default, the live estimate never
   * refetches, and submit validates the untouched default. The user could type
   * any number and the field would appear frozen. Hence the wrapper forwards to
   * durationField.onChange.
   */
  const durationField = register('durationMinutes', {
    required: 'Duration is required',
    valueAsNumber: true,
    validate: (v) =>
      (Number.isFinite(v) && v >= 5 && v <= 480) ||
      'Enter a duration between 5 and 480 minutes',
  })

  const durationMinutes = watch('durationMinutes')
  const fare = watch('fare')

  /**
   * Live standard rate for the chosen duration.
   *
   * Fetched rather than hardcoded because base fee and per-minute rate are
   * admin-configurable (pricingEngine getConfig). A number typed into this file
   * would drift from the server the first time an admin changed pricing, and
   * the form would then reject a perfectly valid fare as out of band.
   */
  useEffect(() => {
    const mins = Number(durationMinutes)
    if (!Number.isFinite(mins) || mins <= 0) {
      setEstimate(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      api.get('/pricing/estimate', { params: { durationMinutes: mins } })
        .then((r) => {
          const d = r.data?.data ?? r.data
          if (!cancelled && d && typeof d.finalAmount === 'number') {
            setEstimate({ finalAmount: d.finalAmount, partnerEarning: d.partnerEarning ?? 0 })
          }
        })
        .catch(() => { if (!cancelled) setEstimate(null) })
    }, 350)
    return () => { cancelled = true; clearTimeout(t) }
  }, [durationMinutes])

  const onSubmit = async (data: FormData) => {
    if (submissionLock.current) return
    submissionLock.current = true
    setLoading(true)
    try {
      // `2026-10-05T14:30` has no timezone, so ES2015+ parses it as local time —
      // which is what "I want a walk at 2:30pm" means. toISOString then hands
      // the server an unambiguous instant.
      const startTime = new Date(`${data.date}T${data.time}`)
      if (Number.isNaN(startTime.getTime())) {
        toast.error('That date and time do not make a valid moment. Please check them.')
        return
      }
      if (startTime.getTime() <= Date.now()) {
        toast.error('Pick a start time in the future.')
        return
      }

      await api.post('/walking-requests', {
        startLocation: data.startLocation.trim(),
        endLocation: data.endLocation.trim(),
        startTime: startTime.toISOString(),
        durationMinutes: Number(data.durationMinutes),
        notes: data.notes.trim() || undefined,
        // Omitted entirely when blank, so resolveWalkingFare prices it itself
        // rather than reading NaN and falling through by accident.
        ...(typeof data.fare === 'number' && Number.isFinite(data.fare) && data.fare > 0
          ? { fare: data.fare }
          : {}),
      })
      toast.success('Walking request created successfully!')
      navigate('/walking-requests')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create request. Please try again.'))
    } finally {
      submissionLock.current = false
      setLoading(false)
    }
  }

  // Warn before submit rather than letting the server 400 on INVALID_FARE.
  const bandError =
    estimate && typeof fare === 'number' && Number.isFinite(fare) && fare > 0 &&
    (fare < estimate.finalAmount * FARE_BAND_MIN || fare > estimate.finalAmount * FARE_BAND_MAX)
      ? `Offered amount must be between ${money(estimate.finalAmount * FARE_BAND_MIN)} and ${money(estimate.finalAmount * FARE_BAND_MAX)} for a ${durationMinutes}-minute walk.`
      : null

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fadeInUp">
      <button
        onClick={() => navigate('/walking-requests')}
        className="flex items-center gap-2 text-surface-500 hover:text-surface-700 dark:hover:text-surface-300 transition-colors group"
      >
        <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
        <span className="text-sm">Back to Requests</span>
      </button>

      <div className="glass-card overflow-hidden">
        <div className="relative px-6 md:px-8 pt-8 pb-16 bg-gradient-to-br from-primary-500/20 via-accent-500/10 to-surface-100 dark:from-primary-900/20 dark:via-accent-900/10 dark:to-surface-900">
          <div className="absolute inset-0 bg-grid opacity-20" />
          <div className="relative flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center shadow-lg shadow-primary-500/30 shrink-0">
              <Sparkles className="w-7 h-7 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">New Request</h1>
              {/* surface-600, not -500: this sits on a from-primary-500/20 tint,
                  which composites to a blue-grey around rgb(205,211,222) where
                  surface-500 measures 3.81:1. */}
              <p className="text-sm text-surface-600 dark:text-surface-400 mt-1">
                Create a walking request
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="px-6 md:px-8 pb-8 -mt-8 space-y-5">
          <div className="bg-white dark:bg-surface-800/80 rounded-2xl p-6 shadow-sm border border-surface-200/50 dark:border-surface-700/50 space-y-5">

            {/* Start & End — WalkingRequest has two non-nullable location columns,
                so both are genuinely required. The old single "location" field
                could not satisfy this even in principle.

                These use the shared LocationInput rather than plain text inputs.
                Free text meant "near the big tree" reached a partner as a
                location, with nothing to sort or route by; LocationInput gives
                place search, GPS auto-detect and a resolved name, which is the
                same component every other location field in the app already
                uses. WalkingRequest stores no coordinates (the columns do not
                exist), so only the resolved name is posted. */}
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <LocationInput
                  label="Meeting point"
                  required
                  value={startLocation}
                  onChange={(v) => setValue('startLocation', v, { shouldValidate: true, shouldDirty: true })}
                  placeholder="Search a place, or use my location"
                />
                {errors.startLocation && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                    {errors.startLocation.message}
                  </p>
                )}
              </div>
              <div>
                <LocationInput
                  label="Walk ends at"
                  required
                  value={endLocation}
                  onChange={(v) => setValue('endLocation', v, { shouldValidate: true, shouldDirty: true })}
                  placeholder="Where are you walking to?"
                />
                {errors.endLocation && (
                  <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                    <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                    {errors.endLocation.message}
                  </p>
                )}
              </div>
            </div>
            <p className="text-xs text-surface-500 dark:text-surface-400 flex items-start gap-1.5">
              <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary-500" />
              Pick a real place so partners nearby can see this request. Typing a landmark
              works, but it cannot be matched to anyone&rsquo;s map.
            </p>

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

            {/* Duration — drives the fare, so it is required */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <Timer className="w-3.5 h-3.5 inline mr-1 text-violet-500" />
                Duration (minutes)
              </label>
              <input
                type="number"
                min={5}
                max={480}
                step={5}
                {...durationField}
                onChange={(e) => {
                  durationField.onChange(e)
                  // Range feedback as you type. react-hook-form only
                  // revalidates on submit by default, so without this the error
                  // would not clear until the next submit. clearErrors rather
                  // than setError with an empty message, so no blank error node
                  // is left behind.
                  const n = Number(e.target.value)
                  if (!Number.isFinite(n)) return
                  if (n < 5) setError('durationMinutes', { message: 'Minimum duration is 5 minutes' })
                  else if (n > 480) setError('durationMinutes', { message: 'Maximum duration is 480 minutes' })
                  else clearErrors('durationMinutes')
                }}
                className={`w-full px-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white transition-colors ${
                  errors.durationMinutes
                    ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                    : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                } focus:outline-none focus:ring-2 focus:ring-offset-0`}
              />
              {errors.durationMinutes && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.durationMinutes.message}
                </p>
              )}
              {errors.durationMinutes && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {errors.durationMinutes.message}
                </p>
              )}
            </div>

            {/* Reward — optional override, with the live standard rate shown so
                an out-of-band number never reaches the server as a 400. */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <IndianRupee className="w-3.5 h-3.5 inline mr-1 text-violet-500" />
                Your offer
                <span className="ml-2 font-normal text-surface-500 dark:text-surface-400">
                  optional — leave blank to accept our standard rate
                </span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-sm font-medium">₹</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder={estimate ? estimate.finalAmount.toFixed(2) : 'Standard rate'}
                  {...register('fare', {
                    // Empty must become undefined, not NaN: resolveWalkingFare
                    // happens to treat NaN as "no offer", but relying on that is
                    // how a blank field turns into a 400 later.
                    setValueAs: (v) => (v === '' || v === null ? undefined : Number(v)),
                  })}
                  className={`w-full pl-8 pr-4 py-2.5 rounded-xl border bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors ${
                    bandError || errors.fare
                      ? 'border-red-300 dark:border-red-700 focus:ring-red-500'
                      : 'border-surface-200 dark:border-surface-700 focus:ring-primary-500'
                  } focus:outline-none focus:ring-2 focus:ring-offset-0`}
                />
              </div>
              {estimate && !bandError && (
                <p className="mt-1 text-xs text-surface-500 dark:text-surface-400">
                  Standard rate for {durationMinutes} minutes: {money(estimate.finalAmount)}
                </p>
              )}
              {bandError && (
                <p className="mt-1 text-xs text-red-500 flex items-center gap-1">
                  <span className="w-1 h-1 rounded-full bg-red-500 inline-block" />
                  {bandError}
                </p>
              )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-1.5">
                <FileText className="w-3.5 h-3.5 inline mr-1 text-surface-500" />
                Notes
              </label>
              <textarea
                {...register('notes')}
                rows={3}
                placeholder="Anything your walking partner should know — pace, route preference, accessibility needs."
                className="w-full px-4 py-2.5 rounded-xl border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800 text-sm text-surface-900 dark:text-white placeholder-surface-400 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-0 resize-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={loading || !!bandError}
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
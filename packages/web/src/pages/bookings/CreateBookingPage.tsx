import { getErrorMessage, getErrorDetail } from '../../lib/error'
import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Footprints, Package, MapPin, Calendar, Clock, Timer,
  FileText, CreditCard, CheckCircle, ArrowLeft, ArrowRight, Loader2
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { LocationInput } from '../../components/LocationInput'
import { SERVICES, serviceTitle, serviceRequiresItem } from '../../lib/serviceCatalog'

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7
type ServiceType = string

interface BookingData {
  serviceType: ServiceType
  pickupLocation: string
  dropLocation: string
  date: string
  time: string
  duration: string
  distance: string
  itemType: string
  itemDescription: string
}

interface PriceEstimate {
  estimatedAmount: number
  platformFee: number
  basePrice: number
  baseFee: number
  timeCharge: number
  distanceCharge: number
  partnerEarning: number
  discount: number
  tax: number
  platformFeePercent: number
  surgeApplied?: boolean
  surgeMultiplier?: number
  distanceKm?: number
  minApplied?: boolean
}

const STEPS = [
  { label: 'Service', icon: Footprints },
  { label: 'Location', icon: MapPin },
  { label: 'Schedule', icon: Calendar },
  { label: 'Details', icon: FileText },
  { label: 'Estimate', icon: CreditCard },
  { label: 'Confirm', icon: CheckCircle },
]

export function CreateBookingPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const initialType = (searchParams.get('type') as ServiceType) || 'WALKING'

  const [step, setStep] = useState<Step>(1)
  const [submitting, setSubmitting] = useState(false)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [estimate, setEstimate] = useState<PriceEstimate | null>(null)
  const [estimateLoading, setEstimateLoading] = useState(false)

  // Wallet-first: bookings are paid from the topped-up wallet balance.
  useEffect(() => {
    api.get('/wallet')
      .then(r => {
        const raw = r.data?.data?.balance ?? r.data?.balance
        setWalletBalance(raw !== undefined && raw !== null ? Number(raw) : null)
      })
      .catch(() => {})
  }, [])

  const [selectedTypes, setSelectedTypes] = useState<ServiceType[]>([initialType])
  const [booking, setBooking] = useState<BookingData>({
    serviceType: initialType,
    pickupLocation: user?.city || '',
    dropLocation: '',
    date: '',
    time: '',
    duration: '60',
    distance: '',
    itemType: '',
    itemDescription: '',
  })
  const [createdBookingId, setCreatedBookingId] = useState<string | null>(null)

  const updateBooking = (data: Partial<BookingData>) => {
    setBooking((prev) => ({ ...prev, ...data }))
  }

  // Fetch the server-computed price estimate so the displayed total always
  // matches exactly what the backend debits from the wallet at booking time
  // (server pricing is admin-configurable + duration/distance aware).
  // Debounced so it recalculates live as the user changes duration or distance.
  useEffect(() => {
    if (!booking.serviceType) {
      setEstimate(null)
      return
    }
    setEstimateLoading(true)
    const duration = Number.parseInt(booking.duration, 10) || 30
    const distance = Number.parseFloat(booking.distance) || 0
    const timer = setTimeout(() => {
      api.get('/bookings/price-estimate', {
        params: {
          serviceType: booking.serviceType,
          durationMinutes: duration,
          ...(distance > 0 ? { distanceKm: distance } : {}),
        },
      })
        .then(r => {
          const d = r.data?.data || r.data
          if (d?.estimatedAmount !== undefined) setEstimate(d)
        })
        .catch(() => setEstimate(null))
        .finally(() => setEstimateLoading(false))
    }, 250)
    return () => clearTimeout(timer)
  }, [booking.serviceType, booking.duration, booking.distance])


  const toggleServiceType = (type: ServiceType) => {
    setSelectedTypes((prev) => {
      const next = prev.includes(type)
        ? prev.filter((item) => item !== type)
        : [...prev, type]
      const primary = next[0] || type
      setBooking((current) => ({ ...current, serviceType: primary }))
      return next.length > 0 ? next : [type]
    })
  }

  const canProceed = () => {
    switch (step) {
      case 1: return !!booking.serviceType
      case 2: return !!booking.pickupLocation
      case 3: return !!booking.date && !!booking.time
      case 4: return booking.serviceType === 'WALKING' || true
      case 5: return true
      case 6: return true
      default: return true
    }
  }

  const handleSubmit = async () => {
    // Booking window: now â†’ +2 months (mirrors backend enforcement)
    const scheduledAt = new Date(`${booking.date}T${booking.time}:00`)
    if (!booking.date || !booking.time || Number.isNaN(scheduledAt.getTime())) {
      toast.error('Please choose a valid date and time.')
      return
    }
    if (scheduledAt.getTime() < Date.now() - 5 * 60 * 1000) {
      toast.error('Booking time must be in the future. Please pick a later slot.')
      return
    }
    if (scheduledAt.getTime() > Date.now() + 60 * 24 * 60 * 60 * 1000) {
      toast.error('Bookings can only be made from today up to 2 months in advance.')
      return
    }
    if (estimateLoading || estimate === null) {
      toast.error('Still calculating your price...')
      return
    }
    if (walletBalance !== null && walletBalance < total) {
      toast.error('Insufficient wallet balance. Please top up first.')
      return
    }

    setSubmitting(true)
    try {
      const normalizedPickup = booking.pickupLocation.trim()
      const normalizedDestination = (booking.dropLocation || booking.pickupLocation).trim()
      const res = await api.post('/bookings', {
        serviceType: selectedTypes.length > 0 ? selectedTypes : [booking.serviceType],
        startLocation: normalizedPickup,
        endLocation: normalizedDestination,
        scheduledAt: `${booking.date}T${booking.time}:00`,
        durationMinutes: Number.parseInt(booking.duration, 10),
        distanceKm: booking.distance ? Number.parseFloat(booking.distance) || undefined : undefined,
        itemType: booking.itemType || undefined,
        itemDescription: booking.itemDescription || undefined,
        notes: booking.itemDescription || undefined,
      })
      const data = res.data?.data || res.data
      const id = data?.id || data?.bookingId
      setCreatedBookingId(id)

      setStep(7)
      toast.success('Booking confirmed! Paid from your wallet.')
    } catch (err: unknown) {
      const code = getErrorDetail(err)
      if (code === 'BOOKING_WINDOW_EXCEEDED') {
        toast.error('Bookings can only be made from today up to 2 months in advance.')
      } else if (code === 'BOOKING_TIME_IN_PAST') {
        toast.error('Booking time must be in the future. Please pick a later slot.')
      } else if (code === 'INSUFFICIENT_BALANCE') {
        toast.error(getErrorMessage(err, 'Insufficient wallet balance. Please top up first.'))
        navigate('/wallet/topup')
      } else if (code === 'MIN_DURATION') {
        toast.error(getErrorMessage(err, 'Booking below the minimum duration for this service.'))
      } else {
        toast.error(getErrorMessage(err, 'Failed to create booking'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const platformFee = estimate?.platformFee ?? 0
  const total = estimate?.estimatedAmount ?? 0
  const insufficientBalance = walletBalance !== null && total > 0 && walletBalance < total
  const today = new Date().toISOString().split('T')[0]
  const maxDate = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

  if (step === 7) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <AnimatedPage>
          <div className="text-center max-w-sm mx-auto">
            <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/30 animate-bounce">
              <CheckCircle className="w-10 h-10 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-2">Booking Confirmed!</h1>
            <p className="text-surface-500 dark:text-surface-400 mb-8">Your {serviceTitle(booking.serviceType).toLowerCase()} booking has been created and payment processed.</p>
            <div className="space-y-3">
              {createdBookingId && (
                <button onClick={() => navigate(`/bookings/${createdBookingId}`)} className="w-full btn-primary">
                  View Booking
                </button>
              )}
              <button onClick={() => navigate('/bookings')} className="w-full btn-outline">
                View All Bookings
              </button>
              <button onClick={() => navigate('/')} className="w-full btn-outline">
                Back to Home
              </button>
            </div>
          </div>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <AnimatedPage>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-surface-900 dark:text-white font-display tracking-tight">Create Booking</h1>
          <p className="text-surface-500 dark:text-surface-400 mt-1.5 text-sm">Step {step} of {STEPS.length}</p>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={25}>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {STEPS.map((_s, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-all ${
                i + 1 <= step
                  ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                  : 'bg-surface-100 dark:bg-surface-800 text-surface-400'
              }`}>
                {i + 1 < step ? <CheckCircle className="w-4 h-4" /> : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-6 h-0.5 rounded-full ${i + 1 < step ? 'bg-primary-500' : 'bg-surface-200 dark:bg-surface-700'}`} />
              )}
            </div>
          ))}
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <GlassCard variant="elevated" padding="lg">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="section-title">Choose Service</h2>
              <p className="text-sm text-surface-500 dark:text-surface-400">Select one or more service types.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SERVICES.map((s) => {
                  const isSelected = selectedTypes.includes(s.key)
                  const accentClasses = isSelected
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/10 shadow-lg shadow-indigo-500/10'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600'
                  return (
                    <button
                      key={s.key}
                      onClick={() => toggleServiceType(s.key)}
                      className={`p-6 rounded-2xl border-2 text-center transition-all ${accentClasses}`}
                    >
                      <div className={`w-14 h-14 mx-auto rounded-2xl flex items-center justify-center mb-4 shadow-lg bg-gradient-to-br ${s.accent}`}>
                        <span className="text-3xl">{s.icon}</span>
                      </div>
                      <p className="text-lg font-bold font-display text-surface-900 dark:text-white">{s.title}</p>
                      <p className="text-sm text-surface-500 mt-1">{s.subtitle}</p>
                      <div className="mt-3 flex items-center justify-center gap-2">
                        <span className="text-[10px] uppercase tracking-wide rounded-full border px-2 py-0.5 border-surface-300 dark:border-surface-600 text-surface-500">
                          {isSelected ? 'Selected' : 'Tap to add'}
                        </span>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="section-title">Pickup & Destination</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => updateBooking({ pickupLocation: user?.city || 'Current city' })}
                  className="btn-outline text-xs py-2 px-3"
                >
                  Use my city
                </button>
                <button
                  type="button"
                  onClick={() => updateBooking({ dropLocation: booking.pickupLocation || user?.city || 'Same as pickup' })}
                  className="btn-outline text-xs py-2 px-3"
                >
                  Set destination to pickup
                </button>
              </div>
              <LocationInput
                label="Pickup Location"
                required
                value={booking.pickupLocation}
                onChange={(v) => updateBooking({ pickupLocation: v })}
                placeholder="Start typing an address or use my location"
              />
              <LocationInput
                label="Destination"
                optional
                value={booking.dropLocation}
                onChange={(v) => updateBooking({ dropLocation: v })}
                placeholder="Enter destination (defaults to pickup)"
              />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="section-title">Date, Time & Duration</h2>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Date *</label>
                <div className="relative">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="date"
                    value={booking.date}
                    onChange={(e) => updateBooking({ date: e.target.value })}
                    min={today}
                    max={maxDate}
                    className="input pl-12 py-3.5"
                  />
                </div>
                <p className="text-xs text-surface-500 mt-1.5">Bookable from today up to 2 months ahead.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Time *</label>
                <div className="relative">
                  <Clock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="time"
                    value={booking.time}
                    onChange={(e) => updateBooking({ time: e.target.value })}
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Duration</label>
                <div className="relative">
                  <Timer className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <select
                    value={booking.duration}
                    onChange={(e) => updateBooking({ duration: e.target.value })}
                    className="input pl-12 py-3.5"
                  >
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="90">1.5 hours</option>
                    <option value="120">2 hours</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">
                  Distance (km) <span className="text-surface-400">Â· optional, used for per-km pricing</span>
                </label>
                <div className="relative">
                  <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={booking.distance}
                    onChange={(e) => updateBooking({ distance: e.target.value })}
                    placeholder="e.g. 3"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 4 && serviceRequiresItem(booking.serviceType) && (
            <div className="space-y-4">
              <h2 className="section-title">Item Details</h2>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Item Type</label>
                <div className="relative">
                  <Package className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
                  <input
                    type="text"
                    value={booking.itemType}
                    onChange={(e) => updateBooking({ itemType: e.target.value })}
                    placeholder="e.g., Documents, Groceries, Package"
                    className="input pl-12 py-3.5"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Description (optional)</label>
                <div className="relative">
                  <FileText className="absolute left-4 top-4 w-5 h-5 text-surface-400" />
                  <textarea
                    value={booking.itemDescription}
                    onChange={(e) => updateBooking({ itemDescription: e.target.value })}
                    placeholder="Describe the item..."
                    rows={3}
                    className="input pl-12 py-3.5 resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 4 && !serviceRequiresItem(booking.serviceType) && (
            <div className="space-y-4">
              <h2 className="section-title">Additional Notes</h2>
              <div>
                <label className="block text-sm font-medium text-surface-700 dark:text-surface-300 mb-2">Notes (optional)</label>
                <div className="relative">
                  <FileText className="absolute left-4 top-4 w-5 h-5 text-surface-400" />
                  <textarea
                    value={booking.itemDescription}
                    onChange={(e) => updateBooking({ itemDescription: e.target.value })}
                    placeholder="Any special instructions..."
                    rows={3}
                    className="input pl-12 py-3.5 resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="section-title">Price Estimate</h2>
              {estimateLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
                  <span className="ml-2 text-sm text-surface-500">Calculating your price...</span>
                </div>
              ) : estimate ? (
                <div className="space-y-3">
                  {estimate.surgeApplied && (
                    <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800">
                      <span className="text-sm font-medium text-amber-700 dark:text-amber-400">
                        Peak pricing applies Ã—{estimate.surgeMultiplier ?? 1}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                    <span className="text-sm text-surface-600 dark:text-surface-400">Base Price</span>
                    <span className="text-sm font-semibold text-surface-900 dark:text-white">₹{(estimate.baseFee ?? estimate.basePrice).toLocaleString('en-IN')}</span>
                  </div>
                  {estimate.timeCharge > 0 && (
                    <div className="flex justify-between items-center p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                      <span className="text-sm text-surface-600 dark:text-surface-400">Time Charge ({booking.duration} min)</span>
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">₹{estimate.timeCharge.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  {estimate.distanceCharge > 0 && (
                    <div className="flex justify-between items-center p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                      <span className="text-sm text-surface-600 dark:text-surface-400">Distance Charge ({estimate.distanceKm ?? booking.distance ?? 0} km)</span>
                      <span className="text-sm font-semibold text-surface-900 dark:text-white">₹{estimate.distanceCharge.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50">
                    <span className="text-sm text-surface-600 dark:text-surface-400">Platform Fee ({estimate.platformFeePercent}%)</span>
                    <span className="text-sm font-semibold text-surface-900 dark:text-white">₹{platformFee.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="h-px bg-surface-200 dark:bg-surface-700" />
                  <div className="flex justify-between items-center p-3 rounded-xl bg-primary-50 dark:bg-primary-900/10">
                    <span className="text-sm font-bold text-surface-900 dark:text-white">Total</span>
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">₹{total.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-danger-500">Could not calculate the price. Please try again.</p>
              )}
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h2 className="section-title">Confirm & Pay</h2>
              <div className="space-y-3">
                <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-800/50 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-surface-500">Service</span>
                    <span className="text-sm font-medium text-surface-900 dark:text-white">{serviceTitle(booking.serviceType)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-surface-500">Pickup</span>
                    <span className="text-sm font-medium text-surface-900 dark:text-white">{booking.pickupLocation}</span>
                  </div>
                  {booking.dropLocation && (
                    <div className="flex justify-between">
                      <span className="text-sm text-surface-500">Destination</span>
                      <span className="text-sm font-medium text-surface-900 dark:text-white">{booking.dropLocation}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-surface-500">Date & Time</span>
                    <span className="text-sm font-medium text-surface-900 dark:text-white">
                      {booking.date} at {booking.time}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-surface-500">Duration</span>
                    <span className="text-sm font-medium text-surface-900 dark:text-white">{booking.duration} min</span>
                  </div>
                  <div className="h-px bg-surface-200 dark:bg-surface-700" />
                  <div className="flex justify-between">
                    <span className="text-sm font-bold text-surface-900 dark:text-white">Total</span>
                    <span className="text-lg font-bold text-primary-600 dark:text-primary-400">₹{total}</span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-sm text-surface-500">Wallet balance</span>
                    <span className={`text-sm font-semibold ${insufficientBalance ? 'text-danger-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {walletBalance === null ? 'â€¦' : `₹${walletBalance.toLocaleString('en-IN')}`}
                    </span>
                  </div>
                  {insufficientBalance && (
                    <div className="rounded-xl border border-danger-200 dark:border-danger-800/40 bg-danger-50 dark:bg-danger-500/10 p-3 mt-1">
                      <p className="text-xs text-danger-600 dark:text-danger-300 font-medium mb-2">
                        Top-up required â€” your wallet needs ₹{(total - (walletBalance ?? 0)).toLocaleString('en-IN')} more to book.
                      </p>
                      <button
                        type="button"
                        onClick={() => navigate('/wallet/topup')}
                        className="btn-primary btn-sm w-full justify-center"
                      >
                        Top Up Wallet First
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={75}>
        <div className="flex gap-3">
          {step > 1 && step < 7 && (
            <button
              onClick={() => setStep((prev) => (prev - 1) as Step)}
              className="flex-1 btn-outline flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
          {step < 6 && (
            <button
              onClick={() => setStep((prev) => (prev + 1) as Step)}
              disabled={!canProceed()}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50"
            >
              Next <ArrowRight className="w-4 h-4" />
            </button>
          )}
          {step === 6 && (
            <button
              onClick={handleSubmit}
              disabled={submitting || insufficientBalance}
              className="flex-1 btn-gradient flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                </>
              ) : (
                <>
                  <CreditCard className="w-4 h-4" /> {insufficientBalance ? 'Top Up Required' : `Pay ₹${total} from Wallet`}
                </>
              )}
            </button>
          )}
        </div>
      </AnimatedPage>
    </div>
  )
}
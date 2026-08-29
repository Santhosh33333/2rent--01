import { getErrorMessage } from '../../lib/error'
import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  CreditCard, Banknote, CheckCircle, XCircle, Loader2, ArrowLeft,
  Star, Clock, MapPin, Navigation, Footprints, Package, ShieldCheck
} from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { openRazorpayBookingCheckout } from '../../lib/razorpay'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { SkeletonLoader } from '../../components/SkeletonLoader'

interface BookingData {
  id: string
  serviceType: string
  startLocation: string
  endLocation?: string
  estimatedAmount: number
  finalAmount?: number
  platformFee?: number
  status: string
  paymentStatus?: string
  scheduledAt?: string
  durationMinutes?: number
  notes?: string
  partner?: {
    user: { id: string; fullName: string; avatarUrl?: string }
    averageRating: number
  }
}

type PaymentMethod = 'ONLINE' | 'CASH' | null

export function BookingPaymentPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [booking, setBooking] = useState<BookingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<PaymentMethod>(null)
  const [confirming, setConfirming] = useState(false)
  const [paying, setPaying] = useState(false)
  const [done, setDone] = useState(false)
  const [doneType, setDoneType] = useState<'ONLINE' | 'CASH' | null>(null)

  useEffect(() => {
    if (!id) return
    api.get(`/bookings/${id}`)
      .then(res => {
        const d = res.data?.data || res.data
        setBooking(d)
        // If payment method already chosen
        if (d?.notes) {
          try { const n = JSON.parse(d.notes); if (n.paymentMethod) setSelected(n.paymentMethod) } catch {}
        }
        if (d?.paymentStatus === 'PAID') { setDone(true); setDoneType('ONLINE') }
        if (d?.paymentStatus === 'CASH_RECEIVED' || d?.paymentStatus === 'PENDING_CASH') { setDone(true); setDoneType('CASH') }
      })
      .catch(() => toast.error('Failed to load booking'))
      .finally(() => setLoading(false))
  }, [id])

  const amount = booking?.estimatedAmount ?? booking?.finalAmount ?? 0
  const platformFee = booking?.platformFee ?? Math.ceil(amount * 0.1)

  const partnerName = booking?.partner?.user?.fullName || 'Your Partner'
  const partnerRating = booking?.partner?.averageRating ?? 0
  const partnerInitial = partnerName.charAt(0).toUpperCase()

  const handleConfirm = async () => {
    if (!selected || !id) return
    setConfirming(true)
    try {
      await api.post(`/bookings/${id}/select-payment-method`, { paymentMethod: selected })
      if (selected === 'CASH') {
        setDone(true)
        setDoneType('CASH')
        toast.success('Cash payment confirmed!')
      } else {
        // Proceed to Razorpay
        setPaying(true)
        await openRazorpayBookingCheckout({
          amount,
          bookingId: id,
          onSuccess: async (paymentId, orderId, signature) => {
            try {
              await api.post(`/bookings/${id}/verify-payment`, { razorpayPaymentId: paymentId, razorpayOrderId: orderId, razorpaySignature: signature })
              setDone(true)
              setDoneType('ONLINE')
              toast.success('Payment successful!')
              setTimeout(() => navigate(`/bookings/${id}`), 2000)
            } catch {
              toast.error('Payment verification failed. Contact support.')
            } finally { setPaying(false) }
          },
          onError: (err) => {
            toast.error(getErrorMessage(err, 'Payment failed'))
            setPaying(false)
          },
        })
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed. Please try again.'))
    } finally {
      setConfirming(false)
    }
  }

  if (loading) return (
    <div className="space-y-6 max-w-lg mx-auto">
      <div className="skeleton h-8 w-48 rounded-2xl" />
      <SkeletonLoader variant="card" />
      <SkeletonLoader variant="card" />
    </div>
  )

  if (!booking) return (
    <div className="text-center py-20">
      <XCircle className="w-12 h-12 text-surface-400 mx-auto mb-4" />
      <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white">Booking not found</h2>
      <button onClick={() => navigate('/bookings')} className="btn-primary btn-sm mt-4">View Bookings</button>
    </div>
  )

  // Success state
  if (done) return (
    <div className="min-h-[70vh] flex items-center justify-center">
      <AnimatedPage>
        <div className="text-center max-w-sm mx-auto px-4">
          <div className={`w-20 h-20 mx-auto rounded-3xl flex items-center justify-center mb-6 shadow-xl ${doneType === 'ONLINE' ? 'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30' : 'bg-gradient-to-br from-amber-500 to-orange-500 shadow-amber-500/30'}`}>
            <CheckCircle className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white mb-2">
            {doneType === 'ONLINE' ? 'Payment Successful!' : 'Booking Confirmed!'}
          </h1>
          <p className="text-surface-500 dark:text-surface-400 mb-2">
            {doneType === 'ONLINE'
              ? `₹${amount.toLocaleString('en-IN')} paid. Searching for partner...`
              : `Pay ₹${amount.toLocaleString('en-IN')} directly to ${partnerName} after the service.`}
          </p>
          {doneType === 'CASH' && (
            <div className="my-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">ðŸ’µ Remember: Pay cash to your partner when the service is complete.</p>
            </div>
          )}
          <button onClick={() => navigate(`/bookings/${id}`)} className="w-full btn-primary mt-4">
            View Booking Details
          </button>
        </div>
      </AnimatedPage>
    </div>
  )

  return (
    <div className="space-y-5 max-w-lg mx-auto pb-8">
      <AnimatedPage>
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <div>
            <h1 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Choose Payment</h1>
            <p className="text-surface-500 dark:text-surface-400 text-sm">Partner accepted your booking</p>
          </div>
        </div>
      </AnimatedPage>

      {/* Partner Card */}
      <AnimatedPage delay={80}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white text-xl font-bold shadow-lg shadow-primary-500/25 flex-shrink-0">
              {partnerInitial}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="font-bold text-surface-900 dark:text-white">{partnerName}</p>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              {partnerRating > 0 && (
                <div className="flex items-center gap-1 mt-0.5">
                  {[1,2,3,4,5].map(s => <Star key={s} className={`w-3 h-3 ${s <= Math.round(partnerRating) ? 'fill-amber-400 text-amber-400' : 'text-surface-300'}`} />)}
                  <span className="text-xs text-surface-500 ml-1">{partnerRating.toFixed(1)}</span>
                </div>
              )}
              <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium">âœ“ Partner has accepted your request</p>
            </div>
            <div className="flex items-center gap-1 text-xs text-surface-500 bg-surface-100 dark:bg-surface-800 px-2 py-1 rounded-lg">
              <Clock className="w-3 h-3" /> ~15 min
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      {/* Booking Summary */}
      <AnimatedPage delay={140}>
        <GlassCard variant="elevated" padding="lg">
          <h3 className="text-sm font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-3">Booking Summary</h3>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${booking.serviceType === 'WALKING' ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                {booking.serviceType === 'WALKING' ? <Footprints className="w-4 h-4 text-emerald-600" /> : <Package className="w-4 h-4 text-amber-600" />}
              </div>
              <span className="text-sm font-semibold text-surface-900 dark:text-white">{booking.serviceType === 'WALKING' ? 'Walking Buddy' : 'CarryBuddy'}</span>
            </div>
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
              <div><p className="text-xs text-surface-500">Pickup</p><p className="text-sm font-medium text-surface-900 dark:text-white">{booking.startLocation}</p></div>
            </div>
            {booking.endLocation && (
              <div className="flex items-start gap-3">
                <Navigation className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
                <div><p className="text-xs text-surface-500">Destination</p><p className="text-sm font-medium text-surface-900 dark:text-white">{booking.endLocation}</p></div>
              </div>
            )}
            <div className="h-px bg-surface-100 dark:bg-surface-800" />
            <div className="flex justify-between text-sm"><span className="text-surface-500">Service fee</span><span className="text-surface-900 dark:text-white">₹{(amount - platformFee).toLocaleString('en-IN')}</span></div>
            <div className="flex justify-between text-sm"><span className="text-surface-500">Platform fee</span><span className="text-surface-900 dark:text-white">₹{platformFee.toLocaleString('en-IN')}</span></div>
            <div className="h-px bg-surface-100 dark:bg-surface-800" />
            <div className="flex justify-between items-center"><span className="font-bold text-surface-900 dark:text-white">Total</span><span className="text-xl font-bold text-primary-600 dark:text-primary-400">₹{amount.toLocaleString('en-IN')}</span></div>
          </div>
        </GlassCard>
      </AnimatedPage>

      {/* Payment Method Selection */}
      <AnimatedPage delay={200}>
        <div>
          <h3 className="text-sm font-bold text-surface-500 dark:text-surface-400 uppercase tracking-wider mb-3 px-1">Choose Payment Method</h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Pay Online */}
            <button
              onClick={() => setSelected('ONLINE')}
              className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-200 ${selected === 'ONLINE' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/10 shadow-lg shadow-emerald-500/10' : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 hover:border-emerald-300'}`}
            >
              {selected === 'ONLINE' && <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><CheckCircle className="w-3.5 h-3.5 text-white" /></div>}
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-3 shadow-md shadow-emerald-500/20">
                <CreditCard className="w-5 h-5 text-white" />
              </div>
              <p className="font-bold text-surface-900 dark:text-white text-sm">Pay Online</p>
              <p className="text-xs text-surface-500 mt-1">UPI, Card, Net Banking</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {['UPI', 'Card'].map(m => <span key={m} className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 font-medium">{m}</span>)}
              </div>
            </button>

            {/* Pay Cash */}
            <button
              onClick={() => setSelected('CASH')}
              className={`relative p-4 rounded-2xl border-2 text-left transition-all duration-200 ${selected === 'CASH' ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/10 shadow-lg shadow-amber-500/10' : 'border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-900 hover:border-amber-300'}`}
            >
              {selected === 'CASH' && <div className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center"><CheckCircle className="w-3.5 h-3.5 text-white" /></div>}
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center mb-3 shadow-md shadow-amber-500/20">
                <Banknote className="w-5 h-5 text-white" />
              </div>
              <p className="font-bold text-surface-900 dark:text-white text-sm">Pay Cash</p>
              <p className="text-xs text-surface-500 mt-1">Pay partner after service</p>
              <div className="mt-2">
                <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 font-medium">Cash</span>
              </div>
            </button>
          </div>

          {selected === 'CASH' && (
            <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30">
              <p className="text-xs text-amber-700 dark:text-amber-400"><span className="font-semibold">Note:</span> Pay ₹{amount.toLocaleString('en-IN')} directly to your partner after the service. The partner will confirm cash receipt.</p>
            </div>
          )}
        </div>
      </AnimatedPage>

      {/* Confirm Button */}
      <AnimatedPage delay={260}>
        <button
          onClick={handleConfirm}
          disabled={!selected || confirming || paying}
          className="w-full btn-gradient py-4 text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {(confirming || paying) ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> {paying ? 'Processing Payment...' : 'Confirming...'}</>
          ) : selected === 'ONLINE' ? (
            <><CreditCard className="w-5 h-5" /> Pay ₹{amount.toLocaleString('en-IN')} Online</>
          ) : selected === 'CASH' ? (
            <><Banknote className="w-5 h-5" /> Confirm Cash Booking</>
          ) : (
            'Select a payment method'
          )}
        </button>
        <p className="text-xs text-center text-surface-400 mt-2">
          {selected === 'ONLINE' ? 'ðŸ”’ Secured by Razorpay' : selected === 'CASH' ? 'ðŸ“ Transaction will be recorded' : 'Choose online or cash to continue'}
        </p>
      </AnimatedPage>
    </div>
  )
}
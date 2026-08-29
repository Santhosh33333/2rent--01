import { useState, useEffect } from 'react'
import { Wallet, IndianRupee, CheckCircle, ArrowLeft, Zap, AlertCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { openRazorpayCheckout } from '../../lib/razorpay'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'

const QUICK_AMOUNTS = [100, 500, 1000, 2000]

export function TopUpPage() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState<number>(0)
  const [customAmount, setCustomAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [balance, setBalance] = useState<number | null>(null)
  const [success, setSuccess] = useState(false)
  const [creditedAmount, setCreditedAmount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const res = await api.get('/wallet')
        setBalance(res.data.data?.balance ?? res.data.balance ?? 0)
      } catch {
        setBalance(0)
      }
    }
    fetchBalance()
  }, [])

  const handleAmountSelect = (value: number) => {
    setAmount(value)
    setCustomAmount('')
  }

  const handleCustomAmountChange = (value: string) => {
    const num = parseInt(value)
    if (!isNaN(num) && num > 0) {
      setAmount(num)
    } else {
      setAmount(0)
    }
    setCustomAmount(value)
  }

  const handleTopUp = () => {
    if (amount < 10) return
    setLoading(true)
    setError(null)

    openRazorpayCheckout({
      amount,
      onSuccess: async (paymentId, orderId, signature) => {
        try {
          await api.post('/payments/verify', {
            razorpayOrderId: orderId,
            razorpayPaymentId: paymentId,
            razorpaySignature: signature,
            amount,
          })
          setCreditedAmount(amount)
          setSuccess(true)
          setBalance((prev) => (prev !== null ? prev + amount : null))
        } catch {
          setError('Payment verification failed. Please contact support if ₹' + amount + ' was debited.')
        } finally {
          setLoading(false)
        }
      },
      onError: (err: any) => {
        setLoading(false)
        const cancelled = err?.message?.toLowerCase().includes('cancel')
        if (!cancelled) {
          setError(err?.message || 'Payment could not be completed. Please try again.')
        }
      },
    })
  }

  if (success) {
    return (
      <div className="space-y-6">
        <AnimatedPage>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
              <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
            </button>
            <h1 className="text-lg font-bold font-display text-surface-900 dark:text-white">Top Up</h1>
            <div className="w-9" />
          </div>
        </AnimatedPage>

        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex flex-col items-center py-8 space-y-6">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 flex items-center justify-center animate-success-bounce">
                <CheckCircle className="w-12 h-12 text-emerald-500" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Payment Successful!</h2>
                <p className="text-surface-500 dark:text-surface-400">
                  ₹{creditedAmount.toLocaleString('en-IN')} has been added to your wallet
                </p>
                {balance !== null && (
                  <p className="text-sm text-surface-400 dark:text-surface-500 mt-2">
                    New balance: ₹{balance.toLocaleString('en-IN')}
                  </p>
                )}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => navigate('/wallet')} className="px-6 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 text-sm font-semibold transition-all text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700">
                  Back to Wallet
                </button>
                <button onClick={() => { setSuccess(false); setAmount(0); setCustomAmount('') }} className="btn-gradient px-6 py-3 rounded-2xl text-sm font-semibold">
                  Top Up More
                </button>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <AnimatedPage>
        <div className="flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
            <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
          </button>
          <h1 className="text-lg font-bold font-display text-surface-900 dark:text-white">Top Up Wallet</h1>
          <div className="w-9" />
        </div>
      </AnimatedPage>

      <AnimatedPage delay={50}>
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-accent-500 p-6 text-white shadow-xl shadow-primary-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
          <div className="absolute -top-16 -right-16 w-48 h-48 bg-white/10 rounded-full blur-3xl" />
          <div className="relative z-10 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center backdrop-blur-sm">
              <Wallet className="w-6 h-6" />
            </div>
            <div>
              <p className="text-white/60 text-sm font-medium">Current Balance</p>
              <p className="text-3xl font-bold font-display">
                {balance !== null ? `₹${balance.toLocaleString('en-IN')}` : '—'}
              </p>
            </div>
          </div>
        </div>
      </AnimatedPage>

      <AnimatedPage delay={100}>
        <GlassCard variant="elevated" padding="lg">
          <div className="flex items-center gap-2 mb-6">
            <IndianRupee className="w-5 h-5 text-primary-500" />
            <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white">Select Amount</h2>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {QUICK_AMOUNTS.map((quickAmount) => (
              <button
                key={quickAmount}
                onClick={() => handleAmountSelect(quickAmount)}
                className={`p-4 rounded-2xl border-2 transition-all text-center ${
                  amount === quickAmount && !customAmount
                    ? 'border-primary-500 bg-primary-500/10 text-primary-600 dark:text-primary-400'
                    : 'border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-600 text-surface-700 dark:text-surface-300'
                }`}
              >
                <span className="text-xl font-bold font-display">₹{quickAmount.toLocaleString('en-IN')}</span>
              </button>
            ))}
          </div>

          <div className="relative mb-6">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-surface-400 font-semibold">₹</span>
            <input
              type="number"
              value={customAmount}
              onChange={(e) => handleCustomAmountChange(e.target.value)}
              placeholder="Enter custom amount"
              min="10"
              className="w-full pl-10 pr-4 py-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-surface-700 text-surface-900 dark:text-white placeholder:text-surface-400 focus:border-primary-500 focus:outline-none transition-colors text-lg font-semibold"
            />
          </div>

          {amount > 0 && amount < 10 && (
            <p className="text-red-500 text-sm mb-4 text-center">Minimum amount is ₹10</p>
          )}

          {error && (
            <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleTopUp}
            disabled={amount < 10 || loading}
            className={`w-full py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
              amount >= 10 && !loading
                ? 'btn-gradient text-white shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30'
                : 'bg-surface-200 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
            }`}
          >
            <Zap className="w-5 h-5" />
            {loading ? 'Processing...' : `Top Up ₹${amount >= 10 ? amount.toLocaleString('en-IN') : '0'}`}
          </button>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

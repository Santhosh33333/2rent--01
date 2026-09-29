import { useState, useEffect, useRef, useCallback } from 'react'
import { Wallet, IndianRupee, ArrowLeft, ShieldCheck, AlertCircle, Loader2, CheckCircle2, Zap } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { load } from '@cashfreepayments/cashfree-js'
import { walletApi, paymentsApi, type CreatedPaymentOrder } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import toast from 'react-hot-toast'

const QUICK_AMOUNTS = [100, 200, 500, 1000]
const MIN_TOPUP = 10

/**
 * Top-up is settled by Cashfree, not by a person reading a bank statement.
 *
 * The old flow asked the user to pay a platform QR, type a UTR from their app,
 * upload a screenshot, and then wait for an admin to credit the wallet. Every
 * one of those steps is a chance for the credit to be wrong, late, or applied
 * twice, and none of them scale past a handful of manual reviews a day.
 */
export function TopUpPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()

  const [amount, setAmount] = useState<number>(0)
  const [customAmount, setCustomAmount] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [paying, setPaying] = useState(false)
  const [settling, setSettling] = useState(false)
  const [settled, setSettled] = useState<'SUCCESS' | 'PENDING' | 'FAILED' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cashfreeRef = useRef<Awaited<ReturnType<typeof load>> | null>(null)
  const started = useRef(false)

  const loadBalance = useCallback(async () => {
    try {
      const res = await walletApi.get()
      const value = Number((res.data as { balance?: number })?.balance ?? 0)
      setBalance(value)
    } catch {
      setBalance(null)
    }
  }, [])

  useEffect(() => {
    loadBalance()
  }, [loadBalance])

  /**
   * Returning from Cashfree is not proof of payment, it is only a prompt to ask
   * the server. The server then reads the authoritative order state from
   * Cashfree and credits the wallet, so a customer cannot reach this page,
   * edit a query string, and mint a balance.
   */
  useEffect(() => {
    if (started.current) return
    if (params.get('payment') !== 'return') return
    const orderId = params.get('order_id')
    if (!orderId) return

    started.current = true
    setSettling(true)
    setError(null)

    ;(async () => {
      try {
        const res = await paymentsApi.verify(orderId)
        const status = String((res.data as { status?: string })?.status ?? '').toUpperCase()
        if (status === 'SUCCESS' || status === 'PAID' || status === 'CAPTURED') {
          setSettled('SUCCESS')
          toast.success('Payment received. Your wallet has been credited.')
        } else if (status === 'FAILED' || status === 'CANCELLED') {
          setSettled('FAILED')
          toast.error('That payment did not go through. No money was taken.')
        } else {
          // Cashfree can settle a moment after the browser returns, so an
          // in-flight order is a normal outcome rather than a failure.
          setSettled('PENDING')
          toast('Payment is still being confirmed. This page updates once it clears.', { icon: '⏳' })
        }
        await loadBalance()
      } catch (e: any) {
        setSettled('PENDING')
        const message = e?.response?.data?.message || 'We could not confirm the payment yet.'
        setError(message)
      } finally {
        setSettling(false)
        setParams({}, { replace: true })
      }
    })()
  }, [params, setParams, loadBalance])

  const handleAmountSelect = (value: number) => {
    setAmount(value)
    setCustomAmount('')
    setError(null)
  }

  const handleCustomAmountChange = (value: string) => {
    setCustomAmount(value)
    setAmount(Number(value) || 0)
    setError(null)
  }

  const handlePay = async () => {
    setError(null)
    if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
      setError(`Enter an amount of at least ₹${MIN_TOPUP}.`)
      return
    }
    setPaying(true)
    try {
      const res = await paymentsApi.createOrder(amount)
      const order = res.data as CreatedPaymentOrder
      const sessionId = order.paymentSessionId
      const hostedUrl = order.paymentUrl

      if (hostedUrl) {
        window.location.href = hostedUrl
        return
      }
      if (!sessionId) {
        throw new Error('The payment provider did not return a way to pay. No money was taken.')
      }

      // The order already exists server-side, so the only thing left is to open
      // Cashfree's hosted checkout. The SDK resolves null in a non-browser
      // context, which would otherwise throw somewhere less obvious.
      if (!cashfreeRef.current) {
        cashfreeRef.current = await load({ mode: 'production' })
      }
      if (!cashfreeRef.current) {
        throw new Error('Secure checkout could not be loaded. Check your connection and try again.')
      }

      const result = await cashfreeRef.current.checkout({
        paymentSessionId: sessionId,
        redirectTarget: '_self',
      })
      if (result?.error) {
        throw new Error(result.error.message || 'Checkout could not be opened.')
      }
      // A redirect leaves the page; anything else is a no-op the return trip
      // will handle.
    } catch (e: any) {
      const message =
        e?.response?.data?.message || e?.message || 'Payment could not be started. Please try again.'
      setError(message)
      setPaying(false)
    }
  }

  const reset = () => {
    setSettled(null)
    setAmount(0)
    setCustomAmount('')
    setError(null)
  }

  if (settling || settled) {
    const tone =
      settled === 'SUCCESS'
        ? { ring: 'bg-emerald-500/10', Icon: CheckCircle2, title: 'Wallet topped up' }
        : settled === 'FAILED'
          ? { ring: 'bg-red-500/10', Icon: AlertCircle, title: 'Payment not completed' }
          : { ring: 'bg-amber-500/10', Icon: Loader2, title: 'Confirming your payment' }
    const { ring, Icon, title } = tone

    return (
      <div className="space-y-6">
        <AnimatedPage>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate('/wallet')} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
              <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
            </button>
            <h1 className="text-lg font-bold font-display text-surface-900 dark:text-white">Top Up Wallet</h1>
            <div className="w-9" />
          </div>
        </AnimatedPage>

        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex flex-col items-center py-8 space-y-6">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center ${ring}`}>
                <Icon className={`w-12 h-12 ${settled === 'SUCCESS' ? 'text-emerald-500' : settled === 'FAILED' ? 'text-red-500' : 'text-amber-500'} ${settling ? 'animate-spin' : ''}`} />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white">{title}</h2>
                {settled === 'SUCCESS' && (
                  <p className="text-surface-500 dark:text-surface-400">
                    Balance is now ₹{(balance ?? 0).toLocaleString('en-IN')}
                  </p>
                )}
                {settled === 'PENDING' && (
                  <p className="text-sm text-surface-500 dark:text-surface-400 max-w-sm">
                    Your bank and Cashfree can take a few seconds to agree. Your wallet is credited as soon as
                    they do, and you do not need to pay again.
                  </p>
                )}
                {settled === 'FAILED' && (
                  <p className="text-sm text-surface-500 dark:text-surface-400">
                    Nothing was charged. You can try again with a different method.
                  </p>
                )}
                {error && <p className="text-sm text-amber-500">{error}</p>}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => navigate('/wallet')} className="px-6 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 text-sm font-semibold transition-all text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700">
                  Back to Wallet
                </button>
                {settled !== 'PENDING' && (
                  <button onClick={reset} className="btn-gradient px-6 py-3 rounded-2xl text-sm font-semibold">
                    Top Up Again
                  </button>
                )}
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>
      </div>
    )
  }

  const canPay = amount >= MIN_TOPUP && !paying

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
        <div className="hero-indigo">
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

      <AnimatedPage delay={80}>
        <GlassCard variant="elevated" padding="lg">
          <div className="space-y-5">
            <div>
              <p className="text-sm font-semibold text-surface-900 dark:text-white mb-3">Choose an amount</p>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((value) => (
                  <button
                    key={value}
                    onClick={() => handleAmountSelect(value)}
                    className={`py-3 rounded-2xl text-sm font-semibold transition-all ${
                      amount === value && !customAmount
                        ? 'btn-gradient text-white shadow-lg'
                        : 'bg-surface-100 dark:bg-surface-800 text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700'
                    }`}
                  >
                    ₹{value}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-surface-900 dark:text-white mb-2 block">Or enter an amount</label>
              <div className="relative">
                <IndianRupee className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
                <input
                  type="number"
                  min={MIN_TOPUP}
                  inputMode="decimal"
                  value={customAmount}
                  onChange={(e) => handleCustomAmountChange(e.target.value)}
                  placeholder={`₹${MIN_TOPUP} or more`}
                  className="w-full pl-11 pr-4 py-3 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
              </div>
            )}

            <button
              onClick={handlePay}
              disabled={!canPay}
              className="btn-gradient w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {paying ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Opening secure checkout…
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Pay ₹{amount >= MIN_TOPUP ? amount.toLocaleString('en-IN') : ''}
                </>
              )}
            </button>

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-surface-500 dark:text-surface-400">
                UPI, cards and net banking are offered by Cashfree's secure checkout. Your wallet is credited
                automatically the moment payment clears, with no reference number and no waiting for approval.
              </p>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>
    </div>
  )
}

export default TopUpPage

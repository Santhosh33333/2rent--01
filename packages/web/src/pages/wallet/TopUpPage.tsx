import { useState, useEffect, useCallback } from 'react'
import {
  Wallet,
  IndianRupee,
  ArrowLeft,
  ShieldCheck,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Copy,
  Upload,
  QrCode,
  Clock,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { walletApi, paymentsApi } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import { AuthImage } from '../../components/AuthImage'
import toast from 'react-hot-toast'

const QUICK_AMOUNTS = [100, 200, 500, 1000]
const MIN_TOPUP = 10

/** Shortest reference the backend will accept, mirrored for early feedback. */
const MIN_REFERENCE = 6

interface PaymentConfig {
  activeMethod: 'gateway' | 'manual_upi' | 'none'
  upiId: string | null
  upiAccountName: string | null
  upiQrUrl: string | null
}

interface TopupRequest {
  id: string
  amount: number | string
  referenceNumber: string
  status: string
  createdAt: string
}

/** Statuses that mean "we are still holding this for review". */
const PENDING_STATUSES = new Set(['VERIFICATION_PENDING', 'PENDING', 'REQUEST_INFO'])

function formatDate(value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/**
 * Top-up is collected manually against the platform UPI QR.
 *
 * Cashfree is retired, so the wallet is credited the same way a booking is: the
 * customer pays the QR, submits the UTR from their banking app, and an admin (or
 * the bank-statement reconciliation job) credits it. The server refuses to credit
 * anything from the browser's word alone, so this screen only ever collects a
 * reference number it can hand to a human.
 *
 * The order of the steps matters: amount first, then the pay-anywhere QR, then the
 * reference. Asking for a UTR before showing where to pay produced empty fields
 * nobody could complete, and letting the QR be the only route broke the flow for
 * the many customers whose banking app cannot scan from the same device.
 */
export function TopUpPage() {
  const navigate = useNavigate()

  const [amount, setAmount] = useState<number>(0)
  const [customAmount, setCustomAmount] = useState('')
  const [balance, setBalance] = useState<number | null>(null)

  const [config, setConfig] = useState<PaymentConfig | null>(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [configError, setConfigError] = useState<string | null>(null)

  /** Once the amount is known we can show the QR and ask for the reference. */
  const [paying, setPaying] = useState(false)
  const [reference, setReference] = useState('')
  const [proof, setProof] = useState<File | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [requests, setRequests] = useState<TopupRequest[]>([])

  const loadBalance = useCallback(async () => {
    try {
      const res = await walletApi.get()
      // The API wraps every payload in { success, data }, so the balance lives at
      // .data.data. Reading .data.balance yields undefined and renders a real
      // balance as "₹0", which is worse than showing nothing.
      const payload = (res.data as { data?: { balance?: number } })?.data
      setBalance(Number(payload?.balance ?? 0))
    } catch {
      setBalance(null)
    }
  }, [])

  const loadRequests = useCallback(async () => {
    try {
      const res = await walletApi.getMyTopupRequests()
      const payload = (res.data as { data?: { items?: TopupRequest[] } })?.data
      setRequests(Array.isArray(payload?.items) ? payload.items : [])
    } catch {
      setRequests([])
    }
  }, [])

  useEffect(() => {
    loadBalance()
    loadRequests()
  }, [loadBalance, loadRequests])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await paymentsApi.getConfig()
        const payload = (res.data as { data?: PaymentConfig })?.data
        if (cancelled) return
        if (!payload) {
          setConfigError('Payment details could not be loaded. Please try again.')
          return
        }
        setConfig(payload)
      } catch {
        if (!cancelled) setConfigError('Payment details could not be loaded. Please try again.')
      } finally {
        if (!cancelled) setConfigLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

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

  const copyUpiId = async () => {
    if (!config?.upiId) return
    try {
      await navigator.clipboard.writeText(config.upiId)
      toast.success('UPI ID copied')
    } catch {
      toast.error('Could not copy. Type the UPI ID manually.')
    }
  }

  const handleSubmit = async () => {
    setError(null)
    const ref = reference.trim()

    if (!Number.isFinite(amount) || amount < MIN_TOPUP) {
      setError(`Enter an amount of at least ₹${MIN_TOPUP}.`)
      return
    }
    if (ref.length < MIN_REFERENCE) {
      setError(`Enter the ${MIN_REFERENCE}+ character UTR / reference from your payment app.`)
      return
    }

    setSubmitting(true)
    try {
      const res = await walletApi.requestTopup({ amount, referenceNumber: ref })
      const created = (res.data as { data?: { id?: string } })?.data

      // The proof is optional and uploaded after the claim exists, because the
      // upload endpoint is keyed on the request id. A failed upload must not lose
      // the claim, so it is reported on its own rather than as a failed submit.
      if (created?.id && proof) {
        try {
          await walletApi.uploadTopupProof(created.id, proof)
        } catch {
          toast.error('Top-up submitted, but the screenshot did not upload. You can add it from your requests.')
        }
      }

      setSubmitted(true)
      setReference('')
      setProof(null)
      await loadRequests()
      toast.success('Top-up submitted for verification')
    } catch (e: any) {
      const message =
        e?.response?.data?.message || e?.message || 'Could not submit the top-up. Please try again.'
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setSubmitted(false)
    setPaying(false)
    setAmount(0)
    setCustomAmount('')
    setReference('')
    setProof(null)
    setError(null)
  }

  const pendingCount = requests.filter((r) => PENDING_STATUSES.has(String(r.status).toUpperCase())).length

  if (submitted) {
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
              <div className="w-20 h-20 rounded-full flex items-center justify-center bg-emerald-500/10">
                <CheckCircle2 className="w-12 h-12 text-emerald-500" />
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white">Top-up submitted</h2>
                <p className="text-sm text-surface-500 dark:text-surface-400 max-w-sm">
                  We are checking ₹{amount.toLocaleString('en-IN')} against our bank statement. Your wallet is
                  credited as soon as it matches — you do not need to pay again.
                </p>
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => navigate('/wallet')} className="px-6 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 text-sm font-semibold transition-all text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700">
                  Back to Wallet
                </button>
                <button onClick={reset} className="btn-gradient px-6 py-3 rounded-2xl text-sm font-semibold">
                  Top Up Again
                </button>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>
      </div>
    )
  }

  const canPay = amount >= MIN_TOPUP
  const upiReady = Boolean(config?.upiId || config?.upiQrUrl)

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
          <div className="absolute inset-0 bg-[url('data:image/svg+xml,%3Csvg%20width%3D%2230%22%20height%3D%2230%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%3E%3Cdefs%3E%3Cpattern%20id%3D%22g%22%20width%3D%2230%22%20height%3D%2230%22%20patternUnits%3D%22userSpaceOnUse%22%3E%3Ccircle%20cx%3D%2215%22%20cy%3D%2215%22%20r%3D%221%22%20fill%3D%22rgba(255,255,255,0.08)%22/%3E%3C/pattern%3E%3C/defs%3E%3Crect%20width%3D%22100%25%22%20height%3D%22100%25%22%20fill%3D%22url(%23g)%22/%3E%3C/svg%3E')] opacity-30" />
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

            {configLoading && (
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50">
                <Loader2 className="w-5 h-5 animate-spin text-surface-400" />
                <p className="text-sm text-surface-500 dark:text-surface-400">Loading payment details…</p>
              </div>
            )}

            {configError && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">{configError}</p>
              </div>
            )}

            {!configLoading && !configError && !upiReady && (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-700 dark:text-amber-400">
                  Top-ups are unavailable right now — no payment address is configured. Please contact support and
                  we will credit you manually once you have paid.
                </p>
              </div>
            )}

            {/* Step 2: where to pay. Shown only once an amount is chosen, so the
                QR always encodes the right value. */}
            {paying && upiReady && (
              <div className="space-y-4 pt-2 border-t border-surface-200 dark:border-surface-700">
                <div className="flex flex-col items-center gap-3">
                  <div className="p-3 rounded-2xl bg-white shadow-lg">
                    <AuthImage
                      url={config?.upiQrUrl}
                      alt="Platform UPI QR code"
                      className="w-48 h-48 object-contain"
                    />
                  </div>
                  <p className="text-xs text-surface-500 dark:text-surface-400 text-center max-w-xs">
                    Scan with any UPI app to pay{' '}
                    <span className="font-semibold text-surface-700 dark:text-surface-200">
                      ₹{amount.toLocaleString('en-IN')}
                    </span>
                    . You can also type the UPI ID by hand.
                  </p>
                </div>

                {config?.upiId && (
                  <div className="flex items-center gap-3 p-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700">
                    <QrCode className="w-5 h-5 text-surface-400 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-surface-500 dark:text-surface-400">UPI ID</p>
                      <p className="font-mono text-sm font-semibold text-surface-900 dark:text-white truncate">
                        {config.upiId}
                      </p>
                      {config.upiAccountName && (
                        <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                          {config.upiAccountName}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={copyUpiId}
                      aria-label="Copy UPI ID"
                      className="p-2 rounded-xl hover:bg-surface-200 dark:hover:bg-surface-700 transition-colors"
                    >
                      <Copy className="w-4 h-4 text-surface-500 dark:text-surface-400" />
                    </button>
                  </div>
                )}

                {/* Step 3: prove it was paid. */}
                <div>
                  <label className="text-sm font-semibold text-surface-900 dark:text-white mb-2 block">
                    UTR / reference number
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder="From your UPI app's payment history"
                    className="w-full px-4 py-3 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700 text-surface-900 dark:text-white placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 transition-all"
                  />
                </div>

                <div>
                  <label className="text-sm font-semibold text-surface-900 dark:text-white mb-2 block">
                    Screenshot (optional)
                  </label>
                  <label className="flex items-center gap-3 p-4 rounded-2xl border border-dashed border-surface-300 dark:border-surface-600 cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50 transition-colors">
                    <Upload className="w-5 h-5 text-surface-400 flex-shrink-0" />
                    <span className="text-sm text-surface-500 dark:text-surface-400 truncate">
                      {proof ? proof.name : 'Attach the payment screenshot'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setProof(e.target.files?.[0] ?? null)}
                    />
                  </label>
                </div>

                {error && (
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                    <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={!canPay || submitting}
                  className="btn-gradient w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      I have paid — submit for verification
                    </>
                  )}
                </button>
              </div>
            )}

            {!paying && (
              <>
                {error && (
                  <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
                    <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-amber-700 dark:text-amber-400">{error}</p>
                  </div>
                )}

                <button
                  onClick={() => { setError(null); setPaying(true) }}
                  disabled={!canPay || configLoading || !upiReady}
                  className="btn-gradient w-full py-4 rounded-2xl font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <QrCode className="w-5 h-5" />
                  Continue to payment
                </button>
              </>
            )}

            <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/5 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-surface-500 dark:text-surface-400">
                Pay by UPI to the platform address above, then send us the reference. Your wallet is credited once
                the payment appears in our bank statement — never from this screen alone.
              </p>
            </div>
          </div>
        </GlassCard>
      </AnimatedPage>

      {requests.length > 0 && (
        <AnimatedPage delay={120}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold font-display text-surface-900 dark:text-white">Your top-ups</h2>
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs font-semibold">
                  <Clock className="w-3.5 h-3.5" />
                  {pendingCount} awaiting review
                </span>
              )}
            </div>
            <ul className="space-y-2">
              {requests.map((r) => {
                const status = String(r.status).toUpperCase()
                const pending = PENDING_STATUSES.has(status)
                return (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-surface-50 dark:bg-surface-800/50"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-surface-900 dark:text-white">
                        ₹{Number(r.amount).toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs text-surface-500 dark:text-surface-400 truncate">
                        {r.referenceNumber} · {formatDate(r.createdAt)}
                      </p>
                    </div>
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap ${
                        pending
                          ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                          : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {pending ? 'Verifying' : status === 'VERIFIED' ? 'Credited' : status}
                    </span>
                  </li>
                )
              })}
            </ul>
          </GlassCard>
        </AnimatedPage>
      )}
    </div>
  )
}

export default TopUpPage
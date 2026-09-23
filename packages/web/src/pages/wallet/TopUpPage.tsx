import { useState, useEffect, useCallback, useRef } from 'react'
import { Wallet, IndianRupee, CheckCircle, ArrowLeft, Zap, AlertCircle, Loader2, ImagePlus, X, QrCode, Clock, FileCheck2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { api, assetUrl, walletApi } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { GlassCard } from '../../components/GlassCard'
import toast from 'react-hot-toast'

const QUICK_AMOUNTS = [100, 500, 1000, 2000]

interface UpiSetup {
  upiManual: boolean
  upiId?: string | null
  upiAccountName?: string | null
  upiQrUrl?: string | null
}

interface TopupRow {
  id: string
  amount: number | string
  referenceNumber: string
  proofImageUrl?: string | null
  status: 'VERIFICATION_PENDING' | 'VERIFIED' | 'REJECTED' | 'REQUEST_INFO'
  verificationNote?: string | null
  createdAt: string
}

const STATUS_META: Record<TopupRow['status'], { label: string; badge: string }> = {
  VERIFICATION_PENDING: { label: 'Pending verification', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  VERIFIED: { label: 'Credited', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  REJECTED: { label: 'Rejected', badge: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  REQUEST_INFO: { label: 'More info needed', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
}

export function TopUpPage() {
  const navigate = useNavigate()
  const [amount, setAmount] = useState<number>(0)
  const [customAmount, setCustomAmount] = useState('')
  const [balance, setBalance] = useState<number | null>(null)
  const [upi, setUpi] = useState<UpiSetup | null>(null)
  const [upiConfigLoading, setUpiConfigLoading] = useState(true)
  const [ref, setRef] = useState('')
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [activeRequest, setActiveRequest] = useState<TopupRow | null>(null)
  const [history, setHistory] = useState<TopupRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const loadStarted = useRef(false)

  const fetchBalance = useCallback(async () => {
    try {
      const res = await walletApi.get()
      const d = res.data?.data || res.data
      setBalance(Number(d?.balance ?? 0))
    } catch {
      setBalance(0)
    }
  }, [])

  const fetchHistory = useCallback(async () => {
    try {
      const res = await walletApi.getMyTopupRequests()
      const d = res.data?.data || res.data
      const rows = Array.isArray(d?.items) ? d.items : Array.isArray(d) ? d : []
      setHistory(rows as TopupRow[])
      const open = (rows as TopupRow[]).find((r) => r.status === 'VERIFICATION_PENDING' || r.status === 'REQUEST_INFO')
      if (open) setActiveRequest(open)
    } catch {
      // keep empty history
    }
  }, [])

  useEffect(() => {
    if (loadStarted.current) return
    loadStarted.current = true
    const ctrl = new AbortController()
    ;(async () => {
      try {
        const configRes = await api.get('/payments/config', { signal: ctrl.signal })
        const d = configRes.data?.data || configRes.data
        setUpi({
          upiManual: Boolean(d?.upiManual),
          upiId: d?.upiId ?? null,
          upiAccountName: d?.upiAccountName ?? null,
          upiQrUrl: d?.upiQrUrl ?? null,
        })
      } catch {
        setUpi(null)
      } finally {
        setUpiConfigLoading(false)
      }
      await Promise.all([fetchBalance(), fetchHistory()])
    })()
    return () => ctrl.abort()
  }, [fetchBalance, fetchHistory])

  const handleAmountSelect = (value: number) => {
    setAmount(value)
    setCustomAmount('')
  }

  const handleCustomAmountChange = (value: string) => {
    const num = parseInt(value)
    setAmount(!isNaN(num) && num > 0 ? num : 0)
    setCustomAmount(value)
  }

  const pickProof = (file: File | undefined) => {
    if (!file) return
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      toast.error('Please choose an image file.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      toast.error('Screenshot must be under 8 MB.')
      return
    }
    if (proofPreview) URL.revokeObjectURL(proofPreview)
    setProofFile(file)
    setProofPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async () => {
    if (amount < 10) {
      toast.error('Minimum top-up is ₹10.')
      return
    }
    const refNum = ref.trim()
    if (refNum.length < 6) {
      toast.error('Enter the UTR / reference number from your payment (min 6 characters).')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await walletApi.requestTopup({ amount, referenceNumber: refNum })
      const d = res.data?.data || res.data
      const row: TopupRow = {
        id: d?.id ?? '',
        amount: d?.amount ?? amount,
        referenceNumber: refNum,
        status: 'VERIFICATION_PENDING',
        createdAt: d?.createdAt ?? new Date().toISOString(),
      }
      // Attach the screenshot if chosen (optional but speeds up verification).
      if (proofFile && row.id) {
        try {
          await walletApi.uploadTopupProof(row.id, proofFile)
          row.proofImageUrl = 'uploaded'
        } catch {
          toast.error('Reference submitted, but the screenshot failed to upload — you can retry from the list below.')
        }
      }
      setActiveRequest(row)
      setHistory((prev) => [row, ...prev])
      setRef('')
      if (proofPreview) URL.revokeObjectURL(proofPreview)
      setProofFile(null)
      setProofPreview(null)
      toast.success('Top-up submitted. Admin will verify and credit your wallet.')
      await fetchBalance()
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to submit top-up.')
    } finally {
      setSubmitting(false)
    }
  }

  const platformUpi = upi?.upiManual ? upi : null
  const canSubmit = amount >= 10 && !submitting && Boolean(platformUpi) && !upiConfigLoading

  if (activeRequest) {
    const meta = STATUS_META[activeRequest.status] || STATUS_META.VERIFICATION_PENDING
    return (
      <div className="space-y-6">
        <AnimatedPage>
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="p-2 rounded-xl hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors">
              <ArrowLeft className="w-5 h-5 text-surface-600 dark:text-surface-400" />
            </button>
            <h1 className="text-lg font-bold font-display text-surface-900 dark:text-white">Wallet Top Up</h1>
            <div className="w-9" />
          </div>
        </AnimatedPage>

        <AnimatedPage delay={100}>
          <GlassCard variant="elevated" padding="lg">
            <div className="flex flex-col items-center py-8 space-y-6">
              <div className={`w-20 h-20 rounded-full flex items-center justify-center animate-success-bounce ${activeRequest.status === 'VERIFIED' ? 'bg-emerald-500/10' : activeRequest.status === 'REJECTED' ? 'bg-red-500/10' : 'bg-amber-500/10'}`}>
                {activeRequest.status === 'VERIFIED' ? (
                  <CheckCircle className="w-12 h-12 text-emerald-500" />
                ) : activeRequest.status === 'REJECTED' ? (
                  <AlertCircle className="w-12 h-12 text-red-500" />
                ) : (
                  <Clock className="w-12 h-12 text-amber-500" />
                )}
              </div>
              <div className="text-center space-y-2">
                <h2 className="text-2xl font-bold font-display text-surface-900 dark:text-white">{meta.label}</h2>
                <p className="text-surface-500 dark:text-surface-400">
                  ₹{Number(activeRequest.amount || 0).toLocaleString('en-IN')} top-up · UTR {activeRequest.referenceNumber}
                </p>
                {activeRequest.verificationNote && (
                  <p className="text-sm text-surface-500 dark:text-surface-400 bg-surface-50 dark:bg-surface-800/50 rounded-xl px-4 py-2 inline-block mt-1">
                    {activeRequest.verificationNote}
                  </p>
                )}
                {activeRequest.status === 'VERIFICATION_PENDING' && (
                  <p className="text-sm text-surface-400">
                    An admin is verifying your payment against the bank statement. You will be notified when the amount is credited.
                  </p>
                )}
                {activeRequest.status === 'REJECTED' && (
                  <p className="text-sm text-amber-500">
                    Your previous reference was rejected. Amounts are only credited after a real match, so a fresh payment with a new reference is required.
                  </p>
                )}
              </div>
              <div className="flex gap-3 mt-4">
                <button onClick={() => navigate('/wallet')} className="px-6 py-3 rounded-2xl bg-surface-100 dark:bg-surface-800 text-sm font-semibold transition-all text-surface-700 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700">
                  Back to Wallet
                </button>
                <button
                  onClick={() => setActiveRequest(null)}
                  className="btn-gradient px-6 py-3 rounded-2xl text-sm font-semibold"
                >
                  {activeRequest.status === 'VERIFIED' ? 'Top Up More' : 'Submit Another'}
                </button>
              </div>
            </div>
          </GlassCard>
        </AnimatedPage>

        {history.length > 1 && <RecentTopups history={history.slice(1)} />}
        {!history.length && <div className="h-4" />}
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

      {/* Platform UPI instructions */}
      <AnimatedPage delay={80}>
        <GlassCard variant="elevated" padding="lg">
          {upiConfigLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-surface-400" />
            </div>
          ) : !platformUpi ? (
            <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30">
              <AlertCircle className="w-5 h-5 text-amber-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">UPI top-up is not configured yet</p>
                <p className="text-xs text-amber-600/70 dark:text-amber-400/70 mt-1">An admin needs to save the platform UPI ID in Settings → UPI before you can top up manually.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <QrCode className="w-5 h-5 text-primary-500" />
                <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white">Pay to the platform UPI</h2>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-surface-500">UPI ID</span>
                <span className="font-bold text-surface-900 dark:text-white">{platformUpi.upiId}</span>
              </div>
              {platformUpi.upiAccountName && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-surface-500">Account</span>
                  <span className="font-medium text-surface-900 dark:text-white">{platformUpi.upiAccountName}</span>
                </div>
              )}
              {platformUpi.upiQrUrl && (
                <img src={assetUrl(platformUpi.upiQrUrl)} alt="UPI QR code" className="w-48 h-48 mx-auto rounded-xl bg-white p-2" />
              )}
              <p className="text-xs text-surface-500">
                Pay the selected amount externally via any UPI app, then enter the UTR / reference number below. An admin verifies the payment against the bank statement before your wallet is credited — no money is added automatically.
              </p>
            </div>
          )}
        </GlassCard>
      </AnimatedPage>

      <AnimatedPage delay={120}>
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

          <div className="mb-4">
            <input
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="UTR / reference number from the payment (min 6 chars)"
              className="w-full px-4 py-4 rounded-2xl bg-surface-50 dark:bg-surface-800/50 border-2 border-surface-200 dark:border-surface-700 text-surface-900 dark:text-white placeholder:text-surface-400 focus:border-primary-500 focus:outline-none transition-colors"
            />
          </div>

          <div>
            <p className="text-xs font-semibold text-surface-600 dark:text-surface-300 mb-2">
              Payment screenshot <span className="font-normal text-surface-400">(optional, speeds up verification)</span>
            </p>
            {proofPreview ? (
              <div className="flex items-center gap-3">
                <img src={proofPreview} alt="Payment proof preview" className="h-24 rounded-xl object-cover border border-surface-200 dark:border-surface-700" />
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-surface-500">Attached — will be sent with your reference.</span>
                  <button
                    type="button"
                    onClick={() => {
                      if (proofPreview) URL.revokeObjectURL(proofPreview)
                      setProofPreview(null)
                      setProofFile(null)
                    }}
                    className="text-xs text-surface-400 hover:text-surface-600 flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" /> Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 rounded-2xl border border-dashed border-surface-300 dark:border-surface-600 px-4 py-3 text-sm text-surface-500 cursor-pointer hover:border-primary-400 transition-colors">
                <ImagePlus className="w-4 h-4" />
                Attach payment screenshot
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => {
                    pickProof(e.target.files?.[0])
                    e.target.value = ''
                  }}
                />
              </label>
            )}
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full mt-5 py-4 rounded-2xl font-bold text-base transition-all flex items-center justify-center gap-2 ${
              canSubmit
                ? 'btn-gradient text-white shadow-lg shadow-primary-500/25 hover:shadow-xl hover:shadow-primary-500/30'
                : 'bg-surface-200 dark:bg-surface-800 text-surface-400 cursor-not-allowed'
            }`}
          >
            {submitting ? <><Loader2 className="w-5 h-5 animate-spin" /> Submitting...</> : <><Zap className="w-5 h-5" /> Submit ₹{amount >= 10 ? amount.toLocaleString('en-IN') : '0'} for verification</>}
          </button>
          <p className="text-xs text-center text-surface-400 mt-3">
            🧾 Verified by admin against the bank statement before your wallet is credited
          </p>
        </GlassCard>
      </AnimatedPage>

      {history.length > 0 && <RecentTopups history={history} />}
    </div>
  )
}

function RecentTopups({ history }: { history: TopupRow[] }) {
  return (
    <AnimatedPage delay={160}>
      <GlassCard variant="elevated" padding="lg">
        <div className="flex items-center gap-2 mb-4">
          <FileCheck2 className="w-5 h-5 text-primary-500" />
          <h2 className="text-lg font-bold font-display text-surface-900 dark:text-white">Recent Top-ups</h2>
        </div>
        <div className="space-y-3">
          {history.map((row) => {
            const meta = STATUS_META[row.status] || STATUS_META.VERIFICATION_PENDING
            return (
              <div key={row.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-surface-50 dark:bg-surface-800/50 border border-surface-200 dark:border-surface-700">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-surface-900 dark:text-white">
                    ₹{Number(row.amount || 0).toLocaleString('en-IN')}
                    <span className="font-normal text-surface-400 text-xs ml-2">UTR {row.referenceNumber}</span>
                  </p>
                  <p className="text-xs text-surface-400 mt-0.5">{new Date(row.createdAt).toLocaleString('en-IN')}</p>
                  {row.verificationNote && row.status !== 'VERIFIED' && (
                    <p className="text-xs text-surface-500 mt-1">{row.verificationNote}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${meta.badge}`}>{meta.label}</span>
                  {row.status === 'VERIFICATION_PENDING' && row.proofImageUrl === 'uploaded' && (
                    <span className="text-[10px] text-emerald-500">Screenshot sent</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </GlassCard>
    </AnimatedPage>
  )
}
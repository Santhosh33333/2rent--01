import { getErrorMessage, getErrorDetail } from '../../lib/error'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, ShieldCheck, XCircle, ArrowLeft, Check, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'

export function PartnerGatePage() {
  const { user, refreshProfile } = useAuth()
  const [status, setStatus] = useState<string | null>(null)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [providesWalking, setProvidesWalking] = useState(true)
  const [providesCarry, setProvidesCarry] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/partner/status')
      const d = res.data?.data ?? res.data
      setStatus(d?.status ?? 'NONE')
      setRejectionReason(d?.rejectionReason ?? null)
    } catch {
      setStatus('NONE')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const handleApply = async () => {
    if (applying) return
    setApplying(true)
    try {
      await api.post('/partner/apply', { providesWalking, providesCarry })
      toast.success('Application submitted for admin review')
      await refreshProfile().catch(() => {})
      load()
    } catch (err: unknown) {
      const code = getErrorDetail(err)
      if (code === 'KYC_REQUIRED' || code === 'KYC_PENDING') {
        toast.error('Complete your KYC verification first.')
      } else {
        toast.error(getErrorMessage(err, 'Failed to submit application'))
      }
    } finally {
      setApplying(false)
    }
  }

  const kycApproved = user?.kycStatus === 'VERIFIED' || user?.kycStatus === 'APPROVED'

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
      <div className="p-6">
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition">
          <ArrowLeft className="w-4 h-4" /> Back
        </Link>
      </div>

      <div className="flex-1 flex items-start justify-center px-6 pb-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-5 rounded-[20px] bg-gradient-to-br from-accent-400 to-accent-600 flex items-center justify-center shadow-xl shadow-accent-500/25">
              <ShieldCheck className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold font-display tracking-tight text-surface-900 dark:text-white">Partner Access</h1>
            <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
              Partner features unlock only after an admin approves your application.
            </p>
          </div>

          {loading ? (
            <div className="py-16 text-center text-surface-500">Checking status…</div>
          ) : !kycApproved ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-center">
              <Clock className="w-10 h-10 mx-auto text-amber-500 mb-3" />
              <h2 className="font-bold text-lg text-surface-900 dark:text-white">KYC verification required</h2>
              <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
                Complete your identity verification and get admin approval before applying as a partner.
              </p>
              <Link to="/verification" className="btn-gradient inline-flex mt-5 px-6 py-3 rounded-xl text-sm font-semibold">
                Go to Verification
              </Link>
            </div>
          ) : status === 'PENDING' || status === 'APPLIED' ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 text-center">
              <Clock className="w-10 h-10 mx-auto text-primary-500 mb-3" />
              <h2 className="font-bold text-lg text-surface-900 dark:text-white">Application under review</h2>
              <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
                An admin is reviewing your partner application. You'll be notified once it's approved.
              </p>
            </div>
          ) : status === 'REJECTED' ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-surface-900 border border-red-300 dark:border-red-800 text-center">
              <XCircle className="w-10 h-10 mx-auto text-red-500 mb-3" />
              <h2 className="font-bold text-lg text-surface-900 dark:text-white">Application rejected</h2>
              {rejectionReason && <p className="mt-2 text-sm text-red-500">{rejectionReason}</p>}
              <button onClick={handleApply} disabled={applying}
                className={`btn-gradient inline-flex mt-5 px-6 py-3 rounded-xl text-sm font-semibold ${applying ? 'opacity-60 pointer-events-none' : ''}`}>
                {applying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Reapply
              </button>
            </div>
          ) : status === 'APPROVED' ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-surface-900 border border-emerald-300 dark:border-emerald-800 text-center">
              <ShieldCheck className="w-10 h-10 mx-auto text-emerald-500 mb-3" />
              <h2 className="font-bold text-lg text-surface-900 dark:text-white">You're an approved partner</h2>
              <Link to="/partner/dashboard" className="btn-gradient inline-flex mt-5 px-6 py-3 rounded-xl text-sm font-semibold">
                Open Partner Dashboard
              </Link>
            </div>
          ) : (
            <div className="p-6 rounded-2xl bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700">
              <h2 className="font-bold text-lg text-surface-900 dark:text-white text-center">Apply as Partner</h2>
              <p className="mt-1 text-sm text-surface-500 dark:text-surface-400 text-center">Select the services you want to provide.</p>

              <div className="space-y-3 mt-5">
                {[
                  { key: 'walking', label: 'Walking Buddy', desc: 'Accompany users on walks, errands and events', checked: providesWalking, toggle: () => setProvidesWalking((v) => !v) },
                  { key: 'carry', label: 'CarryBuddy', desc: 'Help users carry and deliver items safely', checked: providesCarry, toggle: () => setProvidesCarry((v) => !v) },
                ].map((s) => (
                  <button key={s.key} type="button" onClick={s.toggle}
                    className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all active:scale-[0.99] ${
                      s.checked ? 'border-primary-500 bg-primary-500/10' : 'border-surface-200 dark:border-surface-700'
                    }`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      s.checked ? 'border-primary-500 bg-primary-500 text-white' : 'border-surface-300 dark:border-surface-600'
                    }`}>
                      {s.checked && <Check className="w-3 h-3" strokeWidth={3} />}
                    </div>
                    <div className="text-left">
                      <p className="font-semibold text-sm text-surface-900 dark:text-white">{s.label}</p>
                      <p className="text-xs text-surface-500 dark:text-surface-400">{s.desc}</p>
                    </div>
                  </button>
                ))}
              </div>

              <button onClick={handleApply} disabled={applying || (!providesWalking && !providesCarry)}
                className={`btn-gradient w-full mt-6 py-3.5 rounded-xl font-semibold ${applying || (!providesWalking && !providesCarry) ? 'opacity-40 pointer-events-none' : ''}`}>
                {applying ? 'Submitting…' : 'Submit Application'}
              </button>
              <p className="mt-3 text-[11px] text-center text-surface-400">
                After submission, complete payout information and wait for admin approval.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
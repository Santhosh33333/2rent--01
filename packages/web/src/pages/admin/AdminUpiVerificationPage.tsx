import { useState, useEffect } from 'react'
import { QrCode, Search, Check, X, HelpCircle, IndianRupee, User as UserIcon, Clock } from 'lucide-react'
import { adminApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'

interface UpiRow {
  id: string
  referenceNumber: string | null
  amount: number
  currency: string
  status: string
  createdAt: string
  user?: { id: string; fullName?: string; email: string; phone?: string | null } | null
  booking?: { id: string; serviceType: string; status: string; startLocation?: string; endLocation?: string } | null
}

const STATUS_BADGE: Record<string, string> = {
  VERIFICATION_PENDING: 'bg-amber-900/40 text-amber-300',
  VERIFIED: 'bg-emerald-900/40 text-emerald-300',
  REJECTED: 'bg-red-900/40 text-red-300',
  REQUEST_INFO: 'bg-blue-900/40 text-blue-300',
}

export function AdminUpiVerificationPage() {
  const [rows, setRows] = useState<UpiRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [note, setNote] = useState<Record<string, string>>({})

  // Platform UPI config
  const [upi, setUpi] = useState<{ upiId: string | null; accountName: string | null; qrUrl: string | null }>({ upiId: null, accountName: null, qrUrl: null })
  const [upiForm, setUpiForm] = useState({ upiId: '', accountName: '', qrUrl: '' })
  const [upiSaving, setUpiSaving] = useState(false)
  const [upiMsg, setUpiMsg] = useState('')

  const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const params: any = { status: 'VERIFICATION_PENDING', limit: 50 }
      if (search.trim()) params.search = search.trim()
      const res = await adminApi.getUpiPayments(params)
      const d = res.data?.data || res.data
      setRows(Array.isArray(d?.items) ? d.items : [])
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  const loadConfig = async () => {
    try {
      const res = await adminApi.getUpiConfig()
      const c = res.data?.data || res.data
      setUpi({ upiId: c?.upiId ?? null, accountName: c?.accountName ?? null, qrUrl: c?.qrUrl ?? null })
      setUpiForm({ upiId: c?.upiId ?? '', accountName: c?.accountName ?? '', qrUrl: c?.qrUrl ?? '' })
    } catch {
      /* config may be empty */
    }
  }

  useEffect(() => {
    load()
    loadConfig()
  }, [search])

  const act = async (id: string, action: 'VERIFY' | 'REJECT' | 'REQUEST_INFO') => {
    setBusyId(id)
    setError('')
    try {
      await adminApi.verifyUpiPayment(id, { action, note: note[id] })
      await load()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setBusyId(null)
    }
  }

  const saveUpi = async () => {
    setUpiSaving(true)
    setUpiMsg('')
    try {
      if (!upiForm.upiId.trim()) {
        setUpiMsg('UPI ID is required.')
        return
      }
      await adminApi.setUpiConfig(upiForm)
      setUpiMsg('UPI configuration saved.')
      await loadConfig()
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setUpiSaving(false)
    }
  }

  return (
    <div className="bg-surface-50 dark:bg-surface-950 p-4 md:p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-display font-bold text-surface-900 dark:text-white flex items-center gap-2">
          <QrCode className="w-6 h-6 text-primary" /> UPI Verification
        </h1>
        <p className="text-sm text-surface-500 dark:text-surface-400 mt-1">
          Users pay your personal UPI QR externally, then submit the UTR. Verify against your bank statement before confirming the booking.
        </p>

        {error ? <div className="mt-3 rounded-lg bg-red-900/30 text-red-300 px-3 py-2 text-sm">{error}</div> : null}

        {/* Platform UPI config */}
        <div className="mt-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
          <h2 className="font-semibold text-surface-900 dark:text-white mb-3">Platform UPI (your personal QR)</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-white"
              placeholder="UPI ID (e.g. name@bank)"
              value={upiForm.upiId}
              onChange={(e) => setUpiForm({ ...upiForm, upiId: e.target.value })}
            />
            <input
              className="rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-white"
              placeholder="Account name"
              value={upiForm.accountName}
              onChange={(e) => setUpiForm({ ...upiForm, accountName: e.target.value })}
            />
            <input
              className="rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-2 text-sm text-surface-900 dark:text-white"
              placeholder="QR image URL (optional)"
              value={upiForm.qrUrl}
              onChange={(e) => setUpiForm({ ...upiForm, qrUrl: e.target.value })}
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={saveUpi}
              disabled={upiSaving}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {upiSaving ? 'Saving…' : 'Save UPI config'}
            </button>
            {upiMsg ? <span className="text-xs text-emerald-400">{upiMsg}</span> : null}
            {upi.upiId ? (
              <span className="text-xs text-surface-500">Currently: <b>{upi.upiId}</b></span>
            ) : (
              <span className="text-xs text-amber-400">Not configured yet</span>
            )}
          </div>
        </div>

        {/* Pending queue */}
        <div className="mt-4 rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-surface-900 dark:text-white">Pending verification ({rows.length})</h2>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-2.5 text-surface-400" />
              <input
                className="rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 pl-8 pr-3 py-2 text-sm text-surface-900 dark:text-white"
                placeholder="Search reference / user"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {loading ? <p className="text-sm text-surface-500">Loading…</p> : null}
          {!loading && rows.length === 0 ? (
            <p className="text-sm text-surface-500">No pending UPI payments.</p>
          ) : null}

          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className="rounded-lg border border-surface-200 dark:border-surface-800 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] || 'bg-surface-700/40 text-surface-300'}`}>{r.status}</span>
                      <span className="font-semibold text-surface-900 dark:text-white flex items-center gap-1"><IndianRupee className="w-4 h-4" />{inr(r.amount)}</span>
                    </div>
                    <p className="text-sm text-surface-600 dark:text-surface-300 mt-1 flex items-center gap-1">
                      <UserIcon className="w-4 h-4" />
                      {r.user?.fullName || r.user?.email || 'Unknown'} {r.user?.phone ? `· ${r.user.phone}` : ''}
                    </p>
                    <p className="text-sm text-surface-500">Ref: <b>{r.referenceNumber}</b></p>
                    {r.booking ? (
                      <p className="text-xs text-surface-500">
                        {r.booking.serviceType} · {r.booking.startLocation} → {r.booking.endLocation} · {r.booking.status}
                      </p>
                    ) : null}
                    <p className="text-xs text-surface-400 flex items-center gap-1"><Clock className="w-3 h-3" />{new Date(r.createdAt).toLocaleString('en-IN')}</p>
                  </div>
                  <div className="flex flex-col gap-2 items-end">
                    <button
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, 'VERIFY')}
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <Check className="w-4 h-4" /> Verify
                    </button>
                    <button
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, 'REJECT')}
                      className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <X className="w-4 h-4" /> Reject
                    </button>
                    <button
                      disabled={busyId === r.id}
                      onClick={() => act(r.id, 'REQUEST_INFO')}
                      className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      <HelpCircle className="w-4 h-4" /> Info
                    </button>
                  </div>
                </div>
                <input
                  className="mt-2 w-full rounded-lg border border-surface-300 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-3 py-1.5 text-sm text-surface-900 dark:text-white"
                  placeholder="Note / reason (optional)"
                  value={note[r.id] || ''}
                  onChange={(e) => setNote({ ...note, [r.id]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

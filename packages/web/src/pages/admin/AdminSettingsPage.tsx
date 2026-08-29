import { getErrorMessage } from '../../lib/error'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Percent, Save, Loader2, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { adminApi } from '../../lib/api'

interface PricingConfig {
  id: string
  key: string
  value: string
  description?: string | null
  category: string
  isActive: boolean
}

const FEE_KEY = 'PLATFORM_FEE_PERCENT'

export function AdminSettingsPage() {
  const [configs, setConfigs] = useState<PricingConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feeInput, setFeeInput] = useState('')
  const [currentFeeId, setCurrentFeeId] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.getPricingConfigs()
      const d = res.data?.data || res.data
      const list: PricingConfig[] = Array.isArray(d) ? d : d?.items || []
      setConfigs(list)
      const feeRow = list.find((c) => c.key === FEE_KEY && c.isActive)
      setCurrentFeeId(feeRow?.id ?? null)
      setFeeInput(feeRow ? String(Number(feeRow.value)) : '')
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load pricing settings'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const saveFee = async () => {
    const pct = Number(feeInput)
    if (!Number.isFinite(pct) || pct < 0 || pct > 90) {
      toast.error('Enter a fee between 0 and 90 percent')
      return
    }
    setSaving(true)
    try {
      if (currentFeeId) {
        await adminApi.updatePricingConfig(currentFeeId, { value: String(pct), isActive: true })
      } else {
        await adminApi.createPricingConfig({
          key: FEE_KEY,
          value: String(pct),
          description: 'Platform commission percentage charged on every booking',
          category: 'PRICING',
        })
      }
      setSavedAt(new Date().toLocaleTimeString())
      toast.success(`Platform fee updated to ${pct}% â€” applies to all new bookings`)
      await load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save platform fee'))
    } finally {
      setSaving(false)
    }
  }

  const displayValue = (raw: string) => {
    const n = Number(raw)
    return Number.isFinite(n) ? n.toLocaleString('en-IN') : raw
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Link to="/admin/portal" className="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Platform Settings</h1>
            <p className="text-gray-400 text-sm mt-1">Fees and pricing â€” changes apply immediately</p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-3 py-20 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin" /> Loading settings...
          </div>
        ) : (
          <>
            {/* Platform Fee editor */}
            <div className="bg-gray-800 rounded-2xl p-6 mb-6 border border-gray-700/60">
              <div className="flex items-center gap-3 mb-1">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                  <Percent className="w-5 h-5 text-indigo-400" />
                </div>
                <h2 className="text-white font-semibold">Platform Fee</h2>
              </div>
              <p className="text-gray-400 text-sm mb-5 ml-13">
                Percentage commission the platform keeps from every completed booking. Partner earnings are calculated as
                booking amount minus this fee. You can change it at any time â€” new bookings use the latest value.
              </p>

              <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-400 mb-2">Fee percentage (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    step={0.5}
                    value={feeInput}
                    onChange={(e) => { setFeeInput(e.target.value); setSavedAt(null) }}
                    placeholder={feeInput === '' && currentFeeId === null ? '10 (default)' : ''}
                    className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-lg focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={saveFee}
                  disabled={saving || feeInput === ''}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-medium rounded-xl transition"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save fee
                </button>
              </div>

              <p className="text-xs text-gray-500 mt-3 flex items-center gap-1.5">
                {savedAt ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    Saved at {savedAt} Â· currently charging <span className="text-gray-300 font-medium">{feeInput || '10'}%</span>
                  </>
                ) : (
                  <>Currently active value: <span className="text-gray-300 font-medium">{feeInput !== '' ? `${feeInput}%` : '10% (default)'}</span></>
                )}
              </p>
            </div>

            {/* Other pricing config rows */}
            <div className="bg-gray-800 rounded-2xl p-6 border border-gray-700/60">
              <h2 className="text-white font-semibold mb-4">All pricing configuration</h2>
              {configs.length === 0 ? (
                <p className="text-gray-500 text-sm">No pricing overrides yet â€” defaults are in effect.</p>
              ) : (
                <div className="divide-y divide-gray-700/60">
                  {configs.map((c) => (
                    <div key={c.id} className="py-3 flex items-center justify-between gap-4">
                      <div>
                        <p className="text-gray-200 text-sm font-mono">{c.key}</p>
                        {c.description && <p className="text-gray-500 text-xs mt-0.5">{c.description}</p>}
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${c.isActive ? 'bg-emerald-900/40 text-emerald-400' : 'bg-gray-700 text-gray-400'}`}>
                          {c.isActive ? 'active' : 'off'}
                        </span>
                        <span className="text-white text-sm font-medium">{displayValue(c.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
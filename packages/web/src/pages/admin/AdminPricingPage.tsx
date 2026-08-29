import { getErrorMessage } from '../../lib/error'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Beaker, Loader2, Percent, Plus, Save, ShieldCheck } from 'lucide-react'
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

const CATEGORY_LABELS: Record<string, { title: string; blurb: string }> = {
  USER: { title: 'User Fees', blurb: 'Charged to customers on every booking' },
  PARTNER: { title: 'Partner Fees', blurb: 'Commission, payouts and penalties for partners' },
  GENERAL: { title: 'General', blurb: 'Other platform configuration' },
}

export function AdminPricingPage() {
  const [configs, setConfigs] = useState<PricingConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newCategory, setNewCategory] = useState('USER')

  const [simService, setSimService] = useState('WALKING')
  const [simDuration, setSimDuration] = useState('30')
  const [simDistance, setSimDistance] = useState('0')
  const [simDraft, setSimDraft] = useState('')
  const [simBusy, setSimBusy] = useState(false)
  const [simResult, setSimResult] = useState<any>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.getPricingConfigs()
      const d = res.data?.data || res.data
      const list: PricingConfig[] = Array.isArray(d) ? d : d?.items || []
      list.sort((a, b) => a.category.localeCompare(b.category) || a.key.localeCompare(b.key))
      setConfigs(list)
      setDrafts(Object.fromEntries(list.map((c) => [c.id, String(Number(c.value))])))
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load pricing configuration'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const grouped = useMemo(() => {
    const map: Record<string, PricingConfig[]> = {}
    for (const c of configs) {
      ;(map[c.category] ||= []).push(c)
    }
    return map
  }, [configs])

  const saveRow = async (cfg: PricingConfig) => {
    const raw = drafts[cfg.id]
    const num = Number(raw)
    if (!Number.isFinite(num) || num < 0) {
      toast.error(`${cfg.key}: enter a non-negative number`)
      return
    }
    if (cfg.key.includes('PERCENT') && num > 90) {
      toast.error(`${cfg.key}: percentage cannot exceed 90`)
      return
    }
    setSavingId(cfg.id)
    try {
      await adminApi.updatePricingConfig(cfg.id, { value: String(num), isActive: true })
      toast.success(`${cfg.key} updated to ${num}`)
      await load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update'))
    } finally {
      setSavingId(null)
    }
  }

  const addConfig = async () => {
    const key = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    const num = Number(newValue)
    if (!key) return toast.error('Key is required')
    if (!Number.isFinite(num) || num < 0) return toast.error('Value must be a non-negative number')
    try {
      await adminApi.createPricingConfig({
        key,
        value: String(num),
        description: `${CATEGORY_LABELS[newCategory]?.title ?? 'Custom'} fee configured manually`,
        category: newCategory,
      })
      toast.success(`${key} created`)
      setNewKey('')
      setNewValue('')
      await load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create'))
    }
  }

  // Parse draft override text like "BASE_FEE=60, PER_MINUTE_PRICE=3"
  const parseDraft = (): Record<string, number> | undefined => {
    const text = simDraft.trim()
    if (!text) return undefined
    const out: Record<string, number> = {}
    for (const part of text.split(/[,\n]/)) {
      const m = part.trim().match(/^([A-Z_]+)\s*=\s*([\d.]+)$/i)
      if (m) out[m[1].toUpperCase()] = Number(m[2])
    }
    return Object.keys(out).length ? out : undefined
  }

  const runSimulation = async () => {
    const dur = Number(simDuration)
    const km = Number(simDistance)
    if (!Number.isFinite(dur) || dur <= 0) return toast.error('Enter a valid duration (minutes)')
    setSimBusy(true)
    setSimResult(null)
    try {
      const res = await adminApi.simulatePricing({
        serviceType: simService,
        durationMinutes: dur,
        distanceKm: km > 0 ? km : 0,
        draft: parseDraft(),
      })
      setSimResult(res.data?.data || res.data)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to simulate price'))
    } finally {
      setSimBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
              <Percent className="w-6 h-6 text-indigo-600" /> Pricing &amp; Fees
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Server engines read these values on every calculation â€” changes apply immediately.
            </p>
          </div>
          <Link to="/admin/portal" className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
            <ArrowLeft className="w-4 h-4" /> Portal
          </Link>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([category, rows]) => {
              const meta = CATEGORY_LABELS[category] ?? CATEGORY_LABELS.GENERAL
              return (
                <section key={category} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                  <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h2 className="font-semibold text-slate-900">{meta.title}</h2>
                      <p className="text-xs text-slate-500">{meta.blurb}</p>
                    </div>
                  </header>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400 bg-slate-50">
                        <th className="px-5 py-3 font-medium">Key</th>
                        <th className="px-3 py-3 font-medium">Description</th>
                        <th className="px-3 py-3 font-medium w-32">Value</th>
                        <th className="px-5 py-3 font-medium w-20"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((cfg) => (
                        <tr key={cfg.id} className={cfg.isActive ? '' : 'opacity-50'}>
                          <td className="px-5 py-3 font-mono text-xs text-slate-800">{cfg.key}</td>
                          <td className="px-3 py-3 text-slate-500">{cfg.description ?? 'â€”'}</td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min={0}
                              step="any"
                              value={drafts[cfg.id] ?? ''}
                              onChange={(e) => setDrafts((d) => ({ ...d, [cfg.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && saveRow(cfg)}
                              className="w-full rounded-md border border-slate-300 px-2 py-1.5 focus:border-indigo-500 focus:ring-indigo-500"
                            />
                          </td>
                          <td className="px-5 py-3 text-right">
                            <button
                              onClick={() => saveRow(cfg)}
                              disabled={savingId === cfg.id}
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {savingId === cfg.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              )
            })}

            <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <Beaker className="w-5 h-5 text-violet-600" />
                <div>
                  <h2 className="font-semibold text-slate-900">Test Price (Simulator)</h2>
                  <p className="text-xs text-slate-500">
                    Preview user charge, breakdown and partner earning before activating. Optionally enter draft rates to
                    test &quot;what-if&quot; values without saving.
                  </p>
                </div>
              </header>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-[150px_130px_130px] gap-3">
                  <select
                    value={simService}
                    onChange={(e) => { setSimService(e.target.value); setSimResult(null) }}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="WALKING">Walking</option>
                    <option value="CARRY_BUDDY">CarryBuddy</option>
                  </select>
                  <input
                    value={simDuration}
                    onChange={(e) => setSimDuration(e.target.value)}
                    type="number"
                    min={1}
                    placeholder="Minutes"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                  <input
                    value={simDistance}
                    onChange={(e) => setSimDistance(e.target.value)}
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Distance (km)"
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <input
                  value={simDraft}
                  onChange={(e) => { setSimDraft(e.target.value); setSimResult(null) }}
                  placeholder="Draft (optional): BASE_FEE=60, PER_MINUTE_PRICE=3, PER_KM_PRICE=1"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
                />
                <button
                  onClick={runSimulation}
                  disabled={simBusy}
                  className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-white text-sm hover:bg-violet-700 disabled:opacity-50"
                >
                  {simBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Beaker className="w-4 h-4" />} Run test
                </button>

                {simResult && (
                  <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="text-2xl font-bold text-slate-900">
                      ₹{simResult.totals?.userPays?.toLocaleString('en-IN')}
                      <span className="text-sm font-normal text-slate-500 ml-2">
                        for {simResult.durationMinutes} min Â· {simResult.distanceKm} km Â· {simResult.serviceType}
                      </span>
                    </div>
                    <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Base fee</dt>
                        <dd className="font-semibold text-slate-900">₹{simResult.breakdown?.baseFee?.toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Time (₹{simResult.pricing?.perMinutePrice}/min)</dt>
                        <dd className="font-semibold text-slate-900">₹{(simResult.breakdown?.timeCharge ?? 0).toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Distance (₹{simResult.pricing?.perKmPrice}/km)</dt>
                        <dd className="font-semibold text-slate-900">₹{(simResult.breakdown?.distanceCharge ?? 0).toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Platform fee ({simResult.pricing?.platformFeePercent}%)</dt>
                        <dd className="font-semibold text-slate-900">₹{(simResult.breakdown?.platformFee ?? 0).toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Tax</dt>
                        <dd className="font-semibold text-slate-900">₹{(simResult.breakdown?.tax ?? 0).toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-white border border-slate-200 p-3">
                        <dt className="text-xs text-slate-500">Discount</dt>
                        <dd className="font-semibold text-slate-900">₹{(simResult.breakdown?.discount ?? 0).toLocaleString('en-IN')}</dd>
                      </div>
                      <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3">
                        <dt className="text-xs text-emerald-600">Partner earnings</dt>
                        <dd className="font-semibold text-emerald-700">₹{simResult.totals?.partnerEarnings?.toLocaleString('en-IN')}</dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </section>

            <section className="bg-white rounded-xl border border-dashed border-slate-300 p-5">
              <h2 className="font-semibold text-slate-900 mb-3 flex items-center gap-2">
                <Plus className="w-4 h-4 text-indigo-600" /> Add configuration
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_140px_auto] gap-3">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="KEY_NAME"
                  className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm"
                />
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Value"
                  type="number"
                  min={0}
                  step="any"
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="USER">User</option>
                  <option value="PARTNER">Partner</option>
                  <option value="GENERAL">General</option>
                </select>
                <button onClick={addConfig} className="rounded-md bg-slate-900 px-4 py-2 text-white text-sm hover:bg-slate-800">
                  Create
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
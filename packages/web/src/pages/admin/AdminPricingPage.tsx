import { getErrorMessage } from '../../lib/error'
import { useEffect, useMemo, useState } from 'react'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { Beaker, Clock, Loader2, Percent, Plus, Save, ShieldCheck, Users } from 'lucide-react'
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

/** Mirrors the server's TrialSettings plus the counts the panel shows. */
interface TrialConfig {
  days: number
  maxDays: number
  fromConfig: boolean
  usersWithAccess: number
  usersWithoutAccess: number
  bulkGrantNote?: string
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

  // Free trial. Held separately from the config table above because it is not a
  // rate: it is a length of access granted at signup, with a bulk action that
  // reaches real accounts, so it needs its own confirm and its own reason field.
  const [trial, setTrial] = useState<TrialConfig | null>(null)
  const [trialDays, setTrialDays] = useState('')
  const [trialSaving, setTrialSaving] = useState(false)
  const [trialLoadError, setTrialLoadError] = useState<string | null>(null)
  const [bulkDays, setBulkDays] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkReason, setBulkReason] = useState('')

  // Separate from load() on purpose. The trial read is independent of the config
  // table, and folding it in would mean a failure on either hides the other - a
  // pricing row failing to load should not blank the trial control, and vice
  // versa.
  const loadTrial = async () => {
    setTrialLoadError(null)
    try {
      const res = await adminApi.getTrialConfig()
      const d = res.data?.data || res.data
      setTrial(d)
      setTrialDays(String(d?.days ?? ''))
    } catch (err: unknown) {
      setTrialLoadError(getErrorMessage(err, 'Failed to load trial settings'))
    }
  }

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

  const saveTrial = async () => {
    const days = Number(trialDays)
    // Checked here as well as on the server. The server refuses an out-of-range
    // value, and a 400 round-trip to tell an admin "7 is not between 1 and 365"
    // is a worse experience than saying so here.
    if (!Number.isInteger(days) || days < 1 || days > (trial?.maxDays ?? 365)) {
      toast.error(`Enter a whole number of days between 1 and ${trial?.maxDays ?? 365}.`)
      return
    }
    setTrialSaving(true)
    try {
      const res = await adminApi.setTrialDays(days)
      const d = res.data?.data || res.data
      if (d) setTrial((prev) => ({ ...(prev as TrialConfig), ...d }))
      toast.success(`New accounts now get ${days} days.`)
      await loadTrial()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the trial length'))
    } finally {
      setTrialSaving(false)
    }
  }

  const grantToAll = async () => {
    const days = bulkDays.trim() === '' ? undefined : Number(bulkDays)
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > (trial?.maxDays ?? 365))) {
      toast.error(`Enter a whole number of days between 1 and ${trial?.maxDays ?? 365}, or leave it empty to use ${trial?.days ?? 7}.`)
      return
    }
    // Named in the prompt because this rewrites access for every account that
    // does not currently have it, and unlike saving the length it cannot be
    // undone from this screen.
    const affected = trial?.usersWithoutAccess ?? 0
    if (!window.confirm(
      `Give ${affected} account(s) ${days ?? trial?.days ?? 7} days of access now?\n\n` +
      'Accounts that already have access are left untouched, so nobody who paid loses days.',
    )) return

    setBulkBusy(true)
    try {
      const res = await adminApi.grantTrialToAll(days, bulkReason.trim() || undefined)
      const d = res.data?.data || res.data
      toast.success(`${d?.granted ?? 0} account(s) given ${d?.days ?? days} days.`)
      setBulkDays('')
      setBulkReason('')
      await loadTrial()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not apply the trial'))
    } finally {
      setBulkBusy(false)
    }
  }

  useEffect(() => {
    load()
    loadTrial()
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
    <div className="bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <AdminPageHeader
          title="Pricing & Fees"
          subtitle="Server engines read these values on every calculation - changes apply immediately."
          tone="slate"
          leading={<Percent className="w-6 h-6 text-indigo-600" aria-hidden />}
        />

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
                  {/* Wrapped in an overflow container: the card clips overflow,
                      so without this the Value column and its save button ran
                      off the right edge on a phone with no way to scroll to
                      them (the horizontal-scroll twin of the admin tables that
                      already wrap theirs). */}
                  <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
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
                          <td className="px-3 py-3 text-slate-500">{cfg.description ?? '—'}</td>
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
                  </div>
                </section>
              )
            })}

            <section className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <header className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-600" aria-hidden />
                <div>
                  <h2 className="font-semibold text-slate-900">Free Trial</h2>
                  <p className="text-xs text-slate-500">
                    Days of paid access a new account starts with. This is the number the landing pages advertise
                    and the number signup actually grants, so changing it updates both.
                  </p>
                </div>
              </header>

              {trialLoadError ? (
                <div className="p-5">
                  <p className="text-sm text-rose-700">{trialLoadError}</p>
                  <button
                    type="button"
                    onClick={loadTrial}
                    className="mt-3 inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
                  >
                    Retry
                  </button>
                </div>
              ) : !trial ? (
                <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading trial settings
                </div>
              ) : (
                <div className="p-5 space-y-6">
                  <div className="flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="trial-days" className="block text-xs font-medium text-slate-600 mb-1">
                        Days for new accounts
                      </label>
                      <input
                        id="trial-days"
                        type="number"
                        min={1}
                        max={trial.maxDays}
                        value={trialDays}
                        onChange={(e) => setTrialDays(e.target.value)}
                        className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={saveTrial}
                      disabled={trialSaving}
                      className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {trialSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      Save
                    </button>
                    <p className="text-xs text-slate-500">
                      {trial.fromConfig
                        ? 'Currently set to this value.'
                        : 'Nothing saved yet, so new accounts get the built-in default.'}{' '}
                      Maximum {trial.maxDays}.
                    </p>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-lg border border-slate-200 px-3 py-2">
                      <dt className="text-xs text-slate-500">Accounts with access now</dt>
                      <dd className="text-lg font-semibold text-slate-900">{trial.usersWithAccess}</dd>
                    </div>
                    <div className="rounded-lg border border-slate-200 px-3 py-2">
                      <dt className="text-xs text-slate-500">Accounts without access</dt>
                      <dd className="text-lg font-semibold text-slate-900">{trial.usersWithoutAccess}</dd>
                    </div>
                  </dl>

                  <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-4 space-y-3">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900">Give existing accounts a trial</h3>
                      <p className="text-xs text-slate-600 mt-1">
                        {trial.bulkGrantNote ??
                          'Only affects accounts without current access. Accounts that paid are left untouched.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <label htmlFor="bulk-trial-days" className="block text-xs font-medium text-slate-600 mb-1">
                          Days (blank uses {trial.days})
                        </label>
                        <input
                          id="bulk-trial-days"
                          type="number"
                          min={1}
                          max={trial.maxDays}
                          placeholder={String(trial.days)}
                          value={bulkDays}
                          onChange={(e) => setBulkDays(e.target.value)}
                          className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <div className="grow min-w-[200px]">
                        <label htmlFor="bulk-trial-reason" className="block text-xs font-medium text-slate-600 mb-1">
                          Reason (recorded in the audit log)
                        </label>
                        <input
                          id="bulk-trial-reason"
                          type="text"
                          value={bulkReason}
                          onChange={(e) => setBulkReason(e.target.value)}
                          placeholder="e.g. launch promotion"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={grantToAll}
                        disabled={bulkBusy}
                        className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-white hover:bg-amber-700 disabled:opacity-50"
                      >
                        {bulkBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                        Apply to all
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>

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
                        for {simResult.durationMinutes} min · {simResult.distanceKm} km · {simResult.serviceType}
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

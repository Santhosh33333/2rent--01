import { useEffect, useState } from 'react'
import { Loader2, Save, Percent, Power, Tag, Ticket, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { AdminPageHeader } from '../../components/admin/AdminPageHeader'
import { adminApi } from '../../lib/api'
import { getErrorMessage } from '../../lib/error'

/**
 * Subscription plan pricing.
 *
 * Every amount a user sees on /subscription comes from these rows - nothing is
 * hardcoded in the web app. Two prices sit alongside the regular one:
 *
 *   price      - what a renewal costs.
 *   listPrice  - the higher struck-through "was" shown beside the offer.
 *   offerPrice - the discounted FIRST period for someone who has never
 *                subscribed. For a monthly plan that is the "first month" offer;
 *                renewals always pay `price`.
 *
 * Leaving listPrice/offerPrice empty removes the offer entirely, which is why
 * they are clearable rather than required: drawing a discount the product is not
 * granting is worse than showing no discount. The server enforces the same two
 * rules the form checks here (list > price, offer < price).
 */

interface PlanRow {
  id: string
  code: string
  name: string
  description?: string | null
  price: number
  listPrice: number | null
  offerPrice: number | null
  currency: string
  durationDays: number
  trialDays: number
  isActive: boolean
  displayOrder: number
  activeCount?: number
  subscriptions?: { status: string; count: number }[]
}

interface PlanDraft {
  name: string
  price: string
  listPrice: string
  offerPrice: string
  trialDays: string
  displayOrder: string
}

function toDraft(plan: PlanRow): PlanDraft {
  return {
    name: plan.name,
    price: String(plan.price),
    // null renders as an empty box, not "0" - an empty offer must look empty.
    listPrice: plan.listPrice === null ? '' : String(plan.listPrice),
    offerPrice: plan.offerPrice === null ? '' : String(plan.offerPrice),
    trialDays: String(plan.trialDays),
    displayOrder: String(plan.displayOrder),
  }
}

function money(n: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : ''
  return `${symbol}${n.toFixed(n % 1 === 0 ? 0 : 2)}`
}

function cadence(days: number): string {
  if (days % 365 === 0) return days === 365 ? 'year' : `${days / 365} years`
  if (days % 30 === 0) return days === 30 ? 'month' : `${days / 30} months`
  return `${days} days`
}

export function AdminSubscriptionPlansPage() {
  const [plans, setPlans] = useState<PlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({})
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [busyCode, setBusyCode] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await adminApi.getSubscriptionPlans()
      const d = res.data?.data || res.data
      const list: PlanRow[] = Array.isArray(d) ? d : d?.plans || []
      list.sort((a, b) => a.displayOrder - b.displayOrder)
      setPlans(list)
      setDrafts(Object.fromEntries(list.map((p) => [p.code, toDraft(p)])))
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load subscription plans'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const update = (code: string, key: keyof PlanDraft, value: string) => {
    setDrafts((prev) => ({ ...prev, [code]: { ...prev[code], [key]: value } }))
  }

  const save = async (plan: PlanRow) => {
    const draft = drafts[plan.code]
    if (!draft) return

    const price = Number(draft.price)
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Regular price must be a positive number.')
      return
    }
    const listPrice = draft.listPrice.trim() === '' ? null : Number(draft.listPrice)
    if (listPrice !== null && (!Number.isFinite(listPrice) || listPrice <= 0)) {
      toast.error('Was/regular strike price must be a positive number, or blank to remove it.')
      return
    }
    if (listPrice !== null && listPrice <= price) {
      toast.error('The struck-through "was" price must be higher than the regular price.')
      return
    }
    const offerPrice = draft.offerPrice.trim() === '' ? null : Number(draft.offerPrice)
    if (offerPrice !== null && (!Number.isFinite(offerPrice) || offerPrice <= 0)) {
      toast.error('Offer price must be a positive number, or blank to remove the offer.')
      return
    }
    if (offerPrice !== null && offerPrice >= price) {
      toast.error('The offer price must be lower than the regular price.')
      return
    }
    const trialDays = Number(draft.trialDays)
    if (!Number.isInteger(trialDays) || trialDays < 0) {
      toast.error('Trial days must be a whole number, 0 or more.')
      return
    }
    const displayOrder = Number(draft.displayOrder)
    if (!Number.isInteger(displayOrder)) {
      toast.error('Display order must be a whole number.')
      return
    }

    setSavingCode(plan.code)
    try {
      await adminApi.updateSubscriptionPlan(plan.code, {
        name: draft.name.trim(),
        price,
        listPrice,
        offerPrice,
        trialDays,
        displayOrder,
      })
      toast.success(`${plan.name} updated. The pricing screen reflects it now.`)
      await load()
    } catch (err: unknown) {
      // The server's reason is more precise than anything the form can say here
      // (e.g. "Offer price must be lower than the regular price").
      toast.error(getErrorMessage(err, 'Could not save this plan'))
    } finally {
      setSavingCode(null)
    }
  }

  const toggle = async (plan: PlanRow) => {
    setBusyCode(plan.code)
    try {
      await adminApi.toggleSubscriptionPlan(plan.code)
      toast.success(plan.isActive ? `${plan.name} hidden from the paywall.` : `${plan.name} is live.`)
      await load()
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the plan status'))
    } finally {
      setBusyCode(null)
    }
  }

  return (
    <div className="bg-slate-50">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <AdminPageHeader
          title="Subscription Plans"
          subtitle="Set the regular price, the struck-through 'was' price and the first-month offer. The user pricing screen reads these values directly."
          tone="slate"
          leading={<Percent className="h-6 w-6 text-indigo-600" aria-hidden />}
        />

        {loading ? (
          <div className="flex items-center justify-center py-24 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        ) : plans.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-slate-500">
            No subscription plans exist yet.
          </div>
        ) : (
          <div className="space-y-6">
            {plans.map((plan) => {
              const draft = drafts[plan.code] ?? toDraft(plan)
              const price = Number(draft.price)
              const listPrice = draft.listPrice.trim() === '' ? null : Number(draft.listPrice)
              const offerPrice = draft.offerPrice.trim() === '' ? null : Number(draft.offerPrice)
              const offerValid =
                offerPrice !== null && Number.isFinite(offerPrice) && Number.isFinite(price) && offerPrice < price
              const strikeValid =
                listPrice !== null && Number.isFinite(listPrice) && Number.isFinite(price) && listPrice > price
              const activeSubs = plan.activeCount ?? 0

              return (
                <section
                  key={plan.code}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                >
                  <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
                    <Ticket className="h-5 w-5 shrink-0 text-indigo-600" aria-hidden />
                    <div className="min-w-0">
                      <h2 className="font-semibold text-slate-900">{plan.name}</h2>
                      <p className="font-mono text-xs text-slate-500">
                        {plan.code} · {cadence(plan.durationDays)}
                      </p>
                    </div>
                    <span
                      className={`ml-auto rounded-full px-3 py-1 text-xs font-medium ${
                        plan.isActive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {plan.isActive ? 'Active' : 'Hidden'}
                    </span>
                    {activeSubs > 0 && (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <Users className="h-3.5 w-3.5" aria-hidden /> {activeSubs} active
                      </span>
                    )}
                  </header>

                  <div className="grid gap-5 p-5 lg:grid-cols-[1fr_260px]">
                    {/* ---- Editable fields ---- */}
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <label className="block sm:col-span-2">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Plan name</span>
                        <input
                          value={draft.name}
                          onChange={(e) => update(plan.code, 'name', e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">
                          Regular price ({plan.currency})
                        </span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={draft.price}
                          onChange={(e) => update(plan.code, 'price', e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                        <span className="mt-1 block text-[11px] text-slate-400">
                          What a renewal pays.
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">
                          Struck-through "was"
                        </span>
                        <input
                          value={draft.listPrice}
                          onChange={(e) => update(plan.code, 'listPrice', e.target.value)}
                          placeholder="Blank = no strike"
                          inputMode="decimal"
                          className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                        />
                        <span className="mt-1 block text-xs text-slate-500">
                          Shown crossed out beside the offer. Must be higher than the regular price.
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-emerald-600">
                          First-month offer price
                        </span>
                        <input
                          value={draft.offerPrice}
                          onChange={(e) => update(plan.code, 'offerPrice', e.target.value)}
                          placeholder="Blank = no offer"
                          className="w-full rounded-md border border-emerald-300 bg-emerald-50/40 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                        />
                        <span className="mt-1 block text-xs text-slate-500">
                          What a brand-new subscriber pays for the first period. Renewals pay the regular
                          price. Must be lower than the regular price.
                        </span>
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Trial days</span>
                        <input
                          value={draft.trialDays}
                          onChange={(e) => update(plan.code, 'trialDays', e.target.value)}
                          type="number"
                          min={0}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-1 block text-xs font-medium text-slate-600">Display order</span>
                        <input
                          value={draft.displayOrder}
                          onChange={(e) => update(plan.code, 'displayOrder', e.target.value)}
                          type="number"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>

                    {/* ---- Live preview of what the user sees ---- */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-slate-400">
                        <Tag className="h-3.5 w-3.5" aria-hidden /> Preview
                      </p>
                      <div className="flex flex-wrap items-baseline gap-2">
                        {strikeValid && (
                          <span className="text-lg text-slate-400 line-through">
                            {money(listPrice as number, plan.currency)}
                          </span>
                        )}
                        <span className="text-2xl font-semibold text-slate-900">
                          {Number.isFinite(price) ? money(offerValid ? offerPrice! : price, plan.currency) : '—'}
                          <span className="text-sm font-normal text-slate-400">/{cadence(plan.durationDays)}</span>
                        </span>
                      </div>
                      {offerValid && (
                        <p className="mt-2 text-xs text-emerald-600">
                          New-subscriber price · renews at {money(price, plan.currency)}
                        </p>
                      )}
                      {offerPrice !== null && !offerValid && Number.isFinite(offerPrice) && (
                        <p className="mt-2 text-xs text-rose-600">
                          Offer must be lower than the regular price to be shown.
                        </p>
                      )}
                      {listPrice !== null && !strikeValid && Number.isFinite(listPrice) && (
                        <p className="mt-1 text-xs text-rose-600">
                          The "was" price must be higher than the regular price to be shown.
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          onClick={() => save(plan)}
                          disabled={savingCode === plan.code}
                          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {savingCode === plan.code ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="h-4 w-4" />
                          )}
                          Save
                        </button>
                        <button
                          onClick={() => toggle(plan)}
                          disabled={busyCode === plan.code}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium disabled:opacity-50 ${
                            plan.isActive
                              ? 'border-slate-300 text-slate-600 hover:bg-slate-100'
                              : 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                          }`}
                        >
                          {busyCode === plan.code ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                          {plan.isActive ? 'Hide' : 'Activate'}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-500">
                    <Tag className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                    <p>
                      The offer applies to the <strong>first period only</strong> for accounts that have
                      never subscribed. To give one specific person free or extended access, use their
                      account in <span className="font-medium">Users</span> (Free lifetime / trial grant).
                    </p>
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

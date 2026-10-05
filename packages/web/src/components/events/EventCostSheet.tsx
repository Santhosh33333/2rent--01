import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Clock,
  IndianRupee,
  Receipt,
  Sparkles,
  Users,
  Wallet,
} from 'lucide-react'
import { api } from '../../lib/api'
import { Reveal } from '../../components/motion/Reveal'
import { Tilt } from '../../components/motion/Tilt'

/**
 * The event cost sheet.
 *
 * The organizer picks one common amount (or types their own); everything else
 * on this card is derived and labelled as such — nobody types a total, because a
 * typed total is a number that will disagree with the people count the moment
 * someone registers.
 *
 * Preset amounts are fetched from the backend rather than hardcoded, so the set
 * of "common" amounts is one decision made in one place.
 */

export interface CostSheet {
  eventId: string
  title: string
  currency: string
  presets: number[]
  isOrganizer: boolean
  perPerson: number | null
  headcount: number
  capacity: number | null
  seatsLeft: number | null
  total: number | null
  collected: number
  outstanding: number
  /** Set by the organizer once they are done chasing; the API has always sent it. */
  collectionClosed?: boolean
  youOwe: number
  yourShareStatus: 'PENDING' | 'PAID' | 'WAIVED' | null
  rows: Array<{
    userId: string
    registrationStatus: string
    amount: number | null
    status: 'PENDING' | 'PAID' | 'WAIVED'
    paidAt: string | null
  }>
}

const rupees = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`

export function EventCostSheet({ eventId, isOrganizer }: { eventId: string; isOrganizer: boolean }) {
  const [sheet, setSheet] = useState<CostSheet | null>(null)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/events/${eventId}/cost-sheet`)
      setSheet(res.data?.data ?? null)
    } catch {
      setSheet(null)
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  const setAmount = async (amount: number) => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await api.put(`/events/${eventId}/cost-sheet`, { amount })
      setSheet(res.data?.data?.sheet ?? res.data?.data ?? null)
      setNote(`Set to ${rupees(amount)} each. Everyone registered now owes that.`)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not set the amount.')
    } finally {
      setBusy(false)
    }
  }

  const pay = async () => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const res = await api.post(`/events/${eventId}/cost-sheet/pay`)
      setSheet(res.data?.data?.sheet ?? null)
      setNote('Paid. The organizer can see it now.')
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Could not complete the payment.')
    } finally {
      setBusy(false)
    }
  }

  if (!sheet) return null

  const noRateYet = sheet.perPerson === null

  return (
    <Reveal from="up">
      <section
        aria-label="Event cost sheet"
        className="prism-card prism-ring p-1"
      >
        <div className="relative rounded-[calc(1.5rem-1px)] p-5">
          <div className="prism-aurora animate-prism-drift opacity-40" aria-hidden />

          <div className="relative z-10">
            <div className="mb-4 flex items-center gap-3">
              <span className="prism-chip h-10 w-10 text-white shadow-lg shadow-violet-500/20">
                <Receipt className="h-[18px] w-[18px]" aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold font-display tracking-tight text-surface-900 dark:text-white">
                  {isOrganizer ? 'Set and split the amount' : 'What you owe'}
                </h2>
                <p className="text-xs text-surface-500 dark:text-surface-400">
                  {noRateYet
                    ? 'The organizer has not set an amount yet.'
                    : `${rupees(sheet.perPerson ?? 0)} each · ${sheet.headcount} ${
                        sheet.headcount === 1 ? 'person' : 'people'
                      }`}
                </p>
              </div>
            </div>

            {/* The derived total. Deliberately the largest thing on the card. */}
            <div className="mb-4 rounded-2xl bg-white/70 p-4 dark:bg-surface-800/50">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                    Auto total
                  </p>
                  <p className="prism-text font-display text-3xl font-bold leading-tight">
                    {sheet.total === null ? '—' : rupees(sheet.total)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-surface-500 dark:text-surface-400">
                    {noRateYet
                      ? 'Pick an amount to calculate'
                      : `${rupees(sheet.perPerson ?? 0)} × ${sheet.headcount}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                    Collected
                  </p>
                  <p className="font-display text-lg font-bold text-surface-900 dark:text-white">
                    {rupees(sheet.collected)}
                  </p>
                  {sheet.outstanding > 0 && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      {rupees(sheet.outstanding)} pending
                    </p>
                  )}
                </div>
              </div>
            </div>

            {note && (
              <p className="mb-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {note}
              </p>
            )}
            {error && (
              <p className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:bg-red-900/25 dark:text-red-300">
                {error}
              </p>
            )}

            {/* Attendee: pay your own share. */}
            {!isOrganizer && sheet.yourShareStatus === 'PENDING' && sheet.youOwe > 0 && (
              <Tilt max={6} lift={10} scale={1.02}>
                <button
                  type="button"
                  onClick={pay}
                  disabled={busy}
                  className="prism-ring flex w-full items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-primary-600 to-primary-700 p-4 text-left text-white transition active:scale-[0.99] disabled:opacity-60"
                >
                  <span className="flex items-center gap-3">
                    <Wallet className="h-5 w-5 text-white/80" aria-hidden />
                    <span>
                      <span className="block text-sm font-semibold">Pay your share</span>
                      <span className="block text-xs text-white/70">Charged to your wallet</span>
                    </span>
                  </span>
                  <span className="font-display text-lg font-bold">{rupees(sheet.youOwe)}</span>
                </button>
              </Tilt>
            )}

            {!isOrganizer && sheet.yourShareStatus === 'PAID' && (
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700 dark:bg-emerald-900/25 dark:text-emerald-300">
                <Check className="h-4 w-4" aria-hidden /> You have paid your share.
              </p>
            )}

            {/* A rate exists but collection has not opened yet.
                `total` is the projected bill (rate x headcount) while
                `youOwe`/`outstanding` come from EventShare rows the organizer
                creates when they actually open the sheet. Until then those are
                0, so the Pay button is correctly hidden - but the card still
                shows a headline total, which reads as "you owe this and the
                button is broken". Say what is actually true instead. */}
            {!isOrganizer &&
              sheet.yourShareStatus === 'PENDING' &&
              sheet.youOwe === 0 &&
              sheet.perPerson !== null &&
              !sheet.collectionClosed && (
                <p className="flex items-start gap-2 rounded-xl bg-surface-100 px-3 py-2.5 text-xs leading-relaxed text-surface-600 dark:bg-surface-800 dark:text-surface-300">
                  <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>
                    {rupees(sheet.perPerson)} per person applies to this event, but the
                    organizer has not opened collection yet. There is nothing for you to
                    pay right now - you will be able to once they do.
                  </span>
                </p>
              )}

            {/* Organizer: common amounts, then a custom one. */}
            {isOrganizer && (
              <>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                  Common amounts
                </p>
                <div className="mb-3 flex flex-wrap gap-2">
                  {sheet.presets.map((p) => {
                    const active = sheet.perPerson === p
                    return (
                      <button
                        key={p}
                        type="button"
                        disabled={busy}
                        onClick={() => setAmount(p)}
                        aria-pressed={active}
                        className={[
                          'rounded-full px-3.5 py-2 text-sm font-semibold transition',
                          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-1',
                          'disabled:opacity-50 active:scale-[0.97]',
                          active
                            ? 'bg-gradient-to-br from-violet-500 to-primary-600 text-white shadow-md shadow-primary-500/25'
                            : 'bg-white text-surface-700 hover:bg-surface-100 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700',
                        ].join(' ')}
                      >
                        {rupees(p)}
                      </button>
                    )
                  })}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const n = Number(custom)
                    if (Number.isFinite(n) && n > 0) void setAmount(n)
                  }}
                  className="flex gap-2"
                >
                  <label htmlFor={`amount-${eventId}`} className="sr-only">
                    Custom amount per person
                  </label>
                  <div className="relative flex-1">
                    <IndianRupee
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400"
                      aria-hidden
                    />
                    <input
                      id={`amount-${eventId}`}
                      type="number"
                      min={1}
                      step="1"
                      inputMode="numeric"
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      placeholder="Any other amount"
                      className="w-full rounded-2xl border border-surface-200 bg-white py-2.5 pl-9 pr-3 text-sm outline-none transition focus:border-primary-400 focus:ring-2 focus:ring-primary-500/30 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !custom}
                    className="rounded-2xl bg-surface-900 px-4 text-sm font-semibold text-white transition active:scale-[0.97] disabled:opacity-40 dark:bg-white dark:text-surface-900"
                  >
                    Add
                  </button>
                </form>
                <p className="mt-2 text-[11px] text-surface-500 dark:text-surface-400">
                  Adding an amount only changes who has not paid yet. Anyone who already paid keeps
                  what they paid.
                </p>
              </>
            )}

            {/* Organizer: who owes what. */}
            {isOrganizer && sheet.rows.length > 0 && (
              <div className="mt-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  Split across {sheet.headcount}
                </p>
                <ul className="space-y-1.5">
                  {sheet.rows.map((row) => (
                    <li
                      key={row.userId}
                      className="flex items-center justify-between gap-3 rounded-xl bg-white/60 px-3 py-2 text-sm dark:bg-surface-800/40"
                    >
                      <span className="truncate font-mono text-xs text-surface-600 dark:text-surface-300">
                        {row.userId.slice(0, 8)}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="font-semibold text-surface-900 dark:text-white">
                          {row.amount === null ? '—' : rupees(row.amount)}
                        </span>
                        <span
                          className={[
                            'rounded-full px-2 py-0.5 text-[10px] font-bold',
                            row.status === 'PAID'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                              : row.status === 'WAIVED'
                                ? 'bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
                          ].join(' ')}
                        >
                          {row.status}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {!isOrganizer && noRateYet && (
              <p className="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                You will be able to pay here once the organizer sets an amount.
              </p>
            )}
          </div>
        </div>
      </section>
    </Reveal>
  )
}
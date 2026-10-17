import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, RefreshCw, Save, Trash2, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { AdminPageHeader, AdminShell } from '../../components/admin/AdminPageHeader'
import { getErrorMessage } from '../../lib/error'
import { adminApi, type ConnectionCategoryInput, type ConnectionCategoryRow } from '../../lib/api'

/**
 * Admin surface for the live connection categories: which modes each category
 * offers, and what each mode costs per minute.
 *
 * While the table is empty the API serves the ten built-in defaults, which
 * have no row yet — those render read-only until an admin activates them.
 * Activation is an idempotent seed that never overwrites an edited row.
 *
 * Edits are staged per row in `drafts` and written by that row's Save, so
 * saving one category never silently discards half-finished edits on another.
 * Loading after an add/delete/seed keeps the drafts; loading after an error
 * re-reads them from the server.
 */

type Draft = {
  label: string
  description: string
  chatEnabled: boolean
  callEnabled: boolean
  videoEnabled: boolean
  chatPricePerMinute: string
  callPricePerMinute: string
  videoPricePerMinute: string
  sortOrder: string
  enabled: boolean
}

function toDraft(c: ConnectionCategoryRow): Draft {
  return {
    label: c.label,
    description: c.description ?? '',
    chatEnabled: c.chatEnabled,
    callEnabled: c.callEnabled,
    videoEnabled: c.videoEnabled,
    chatPricePerMinute: String(c.chatPricePerMinute),
    callPricePerMinute: String(c.callPricePerMinute),
    videoPricePerMinute: String(c.videoPricePerMinute),
    sortOrder: String(c.sortOrder),
    enabled: c.enabled,
  }
}

/**
 * Empty or negative input is invalid, not zero: an accidentally cleared field
 * must never quietly turn a paid mode free.
 */
function parsePrice(raw: string): number | null {
  const t = raw.trim()
  if (t === '') return null
  const n = Number(t)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100) / 100
}

/** Same rule the server stores: paid only if a switched-on mode costs something. */
function draftIsPaid(d: Draft): boolean {
  return (
    (d.chatEnabled && (parsePrice(d.chatPricePerMinute) ?? 0) > 0) ||
    (d.callEnabled && (parsePrice(d.callPricePerMinute) ?? 0) > 0) ||
    (d.videoEnabled && (parsePrice(d.videoPricePerMinute) ?? 0) > 0)
  )
}

/** The permanent identifier is derived from the label, never typed by hand. */
function deriveKey(label: string): string {
  return label.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function ModeRow({
  label,
  checked,
  price,
  disabled,
  onChecked,
  onPrice,
}: {
  label: string
  checked: boolean
  price: string
  disabled: boolean
  onChecked: (v: boolean) => void
  onPrice: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="flex w-24 shrink-0 items-center gap-2 text-sm text-gray-200">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-4 w-4 accent-primary-600"
        />
        {label}
      </label>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">₹</span>
        <input
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={price}
          disabled={disabled}
          onChange={(e) => onPrice(e.target.value)}
          aria-label={`${label} price per minute`}
          className="w-24 rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-white focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="text-xs text-gray-500">/min</span>
      </div>
    </div>
  )
}

const INPUT =
  'w-full rounded-md border border-gray-700 bg-gray-950 px-2.5 py-1.5 text-sm text-white focus:border-primary-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60'

export function AdminConnectionCategoriesPage() {
  const [items, setItems] = useState<ConnectionCategoryRow[]>([])
  const [source, setSource] = useState<'db' | 'defaults'>('db')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addBusy, setAddBusy] = useState(false)
  const [newLabel, setNewLabel] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newCallRate, setNewCallRate] = useState('1')

  const load = useCallback(async (draftsFromServer: boolean) => {
    setLoadError(null)
    setLoading(true)
    try {
      const res = await adminApi.listConnectionCategories()
      const d = (res.data?.data ?? res.data) as
        | { items?: ConnectionCategoryRow[]; source?: string }
        | undefined
      const list: ConnectionCategoryRow[] = Array.isArray(d?.items) ? d.items : []
      setItems(list)
      setSource(d?.source === 'defaults' ? 'defaults' : 'db')
      setDrafts((prev) => {
        const next: Record<string, Draft> = {}
        for (const c of list) {
          next[c.key] = !draftsFromServer && prev[c.key] ? prev[c.key] : toDraft(c)
        }
        return next
      })
    } catch (err) {
      setLoadError(getErrorMessage(err, 'Could not load connection categories.'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(true)
  }, [load])

  const updateDraft = (row: ConnectionCategoryRow, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [row.key]: { ...(prev[row.key] ?? toDraft(row)), ...patch } }))
  }

  const saveRow = async (row: ConnectionCategoryRow, draft: Draft) => {
    if (!row.id) return
    const label = draft.label.trim()
    if (!label) {
      toast.error('Give the category a name.')
      return
    }
    if (label.length > 60) {
      toast.error('Names are limited to 60 characters.')
      return
    }
    const chatPrice = parsePrice(draft.chatPricePerMinute)
    const callPrice = parsePrice(draft.callPricePerMinute)
    const videoPrice = parsePrice(draft.videoPricePerMinute)
    if (chatPrice === null || callPrice === null || videoPrice === null) {
      toast.error('Enter a rate for every mode, or 0 to make it free.')
      return
    }
    const sortOrder = Number(draft.sortOrder)
    const payload: ConnectionCategoryInput = {
      label,
      description: draft.description.trim() || null,
      chatEnabled: draft.chatEnabled,
      callEnabled: draft.callEnabled,
      videoEnabled: draft.videoEnabled,
      chatPricePerMinute: chatPrice,
      callPricePerMinute: callPrice,
      videoPricePerMinute: videoPrice,
      enabled: draft.enabled,
      sortOrder: Number.isFinite(sortOrder) ? Math.trunc(sortOrder) : 0,
    }

    setBusyKey(row.key)
    try {
      const res = await adminApi.updateConnectionCategory(row.id, payload)
      const saved = (res.data?.data ?? res.data) as ConnectionCategoryRow | undefined
      if (saved?.id) {
        setItems((prev) => prev.map((c) => (c.id === saved.id ? saved : c)))
        setDrafts((prev) => ({ ...prev, [saved.key]: toDraft(saved) }))
        toast.success(`${saved.label} saved.`)
      } else {
        // The write succeeded but there is nothing to reconcile from — re-read
        // rather than leave the table showing numbers that no longer exist.
        await load(false)
        toast.success(`${label} saved.`)
      }
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not save the category.'))
    } finally {
      setBusyKey(null)
    }
  }

  const deleteRow = async (row: ConnectionCategoryRow) => {
    if (!row.id) return
    const warning =
      items.length === 1
        ? 'This is your only saved category. Deleting it brings the built-in defaults back.'
        : 'People will no longer be able to pick this category.'
    if (!window.confirm(`Delete "${row.label}"?\n\n${warning} This cannot be undone.`)) return
    setBusyKey(row.key)
    try {
      await adminApi.deleteConnectionCategory(row.id)
      toast.success(`${row.label} deleted.`)
      await load(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not delete the category.'))
    } finally {
      setBusyKey(null)
    }
  }

  const activate = async () => {
    setSeeding(true)
    try {
      const res = await adminApi.seedConnectionCategories()
      const d = (res.data?.data ?? res.data) as { created?: number; skipped?: number } | undefined
      const created = d?.created ?? 0
      const skipped = d?.skipped ?? 0
      toast.success(
        created === 0
          ? 'Already activated.'
          : `Activated ${created} categories${skipped ? `, kept ${skipped} you had already changed` : ''}.`,
      )
      await load(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not activate the defaults.'))
    } finally {
      setSeeding(false)
    }
  }

  const addCategory = async () => {
    const label = newLabel.trim()
    if (!label) {
      toast.error('Give the category a name.')
      return
    }
    if (label.length > 60) {
      toast.error('Names are limited to 60 characters.')
      return
    }
    const key = deriveKey(label)
    if (key.length < 2) {
      toast.error('The name needs at least two letters or digits.')
      return
    }
    const callPrice = parsePrice(newCallRate)
    if (callPrice === null) {
      toast.error('Enter a call rate, or 0 to make calls free.')
      return
    }
    const payload: ConnectionCategoryInput = {
      key,
      label,
      description: newDescription.trim() || null,
      chatEnabled: true,
      callEnabled: true,
      videoEnabled: false,
      chatPricePerMinute: 0,
      callPricePerMinute: callPrice,
      videoPricePerMinute: 0,
      enabled: true,
      sortOrder: items.reduce((max, c) => Math.max(max, c.sortOrder), 0) + 10,
    }

    setAddBusy(true)
    try {
      await adminApi.createConnectionCategory(payload)
      toast.success(`${label} added.`)
      setNewLabel('')
      setNewDescription('')
      setNewCallRate('1')
      setAdding(false)
      await load(false)
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not add the category.'))
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <AdminShell width="max-w-6xl">
      <AdminPageHeader
        title="Connection categories"
        subtitle="Modes and per-minute rates for the live connection flow"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {source === 'defaults' && (
              <button
                type="button"
                onClick={() => void activate()}
                disabled={seeding}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-60"
              >
                {seeding ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Zap className="h-4 w-4" aria-hidden />
                )}
                Activate defaults
              </button>
            )}
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="inline-flex items-center gap-2 rounded-lg bg-gray-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-700"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add category
            </button>
          </div>
        }
      />

      {source === 'defaults' && !loading && !loadError && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-warning-500/40 bg-warning-500/10 px-4 py-3">
          <Zap className="mt-0.5 h-4 w-4 shrink-0 text-warning-400" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold text-warning-300">Showing the built-in defaults</p>
            <p className="mt-0.5 text-warning-200/90">
              They are live for users but read-only here. Select{' '}
              <span className="font-semibold">Activate defaults</span> to save them as rows you can
              edit. Rows you have already changed are never overwritten.
            </p>
          </div>
        </div>
      )}

      <p className="mb-4 text-xs leading-relaxed text-gray-500">
        These rates are stored for the connection flow. Live call billing still reads its own global
        rate today, so a price changed here is not yet charged to anyone.
      </p>

      {adding && (
        <div className="mb-4 rounded-xl border border-gray-800 bg-gray-900 p-4">
          <h2 className="text-sm font-semibold text-white">New category</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">Name</span>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                maxLength={60}
                placeholder="Board Game Buddy"
                className={INPUT}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Key (derived, permanent)
              </span>
              <input
                readOnly
                value={deriveKey(newLabel)}
                placeholder="—"
                className="w-full rounded-md border border-gray-800 bg-gray-900 px-2.5 py-1.5 font-mono text-sm text-gray-500"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">Call rate (₹/min)</span>
              <input
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={newCallRate}
                onChange={(e) => setNewCallRate(e.target.value)}
                className={INPUT}
              />
            </label>
            <label className="block sm:col-span-2 lg:col-span-3">
              <span className="mb-1 block text-xs font-medium text-gray-400">
                Description (optional)
              </span>
              <input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                maxLength={200}
                placeholder="What this category is for"
                className={INPUT}
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Starts with Chat free, Call at the rate above and Video off. You can change all of it
            after adding.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void addCategory()}
              disabled={addBusy}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-60"
            >
              {addBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Add category
            </button>
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-lg bg-gray-800 px-3.5 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-gray-800 bg-gray-900 py-16 text-sm text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
          Loading categories…
        </div>
      ) : loadError ? (
        <div className="rounded-xl border border-danger-500/40 bg-danger-500/10 px-4 py-8 text-center">
          <p className="text-sm text-danger-300">{loadError}</p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-gray-800 px-3.5 py-2 text-sm font-semibold text-white hover:bg-gray-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900 px-4 py-10 text-center text-sm text-gray-400">
          No categories yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-800">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-gray-900">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Modes &amp; rates (₹/min)</th>
                <th className="px-4 py-3 font-medium">Order</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {items.map((row) => {
                const draft = drafts[row.key] ?? toDraft(row)
                const busy = busyKey === row.key
                const canEdit = Boolean(row.id)
                const paid = draftIsPaid(draft)
                return (
                  <tr key={row.id ?? row.key} className="bg-gray-950 align-top">
                    <td className="min-w-[240px] px-4 py-4">
                      <input
                        value={draft.label}
                        disabled={!canEdit}
                        maxLength={60}
                        onChange={(e) => updateDraft(row, { label: e.target.value })}
                        aria-label="Category name"
                        className={INPUT}
                      />
                      <p className="mt-1 font-mono text-xs text-gray-500">{row.key}</p>
                      <input
                        value={draft.description}
                        disabled={!canEdit}
                        maxLength={200}
                        placeholder="Description"
                        onChange={(e) => updateDraft(row, { description: e.target.value })}
                        aria-label="Description"
                        className={`${INPUT} mt-1.5 text-xs text-gray-300 placeholder:text-gray-600`}
                      />
                    </td>
                    <td className="min-w-[280px] space-y-2 px-4 py-4">
                      <ModeRow
                        label="Chat"
                        checked={draft.chatEnabled}
                        price={draft.chatPricePerMinute}
                        disabled={!canEdit}
                        onChecked={(v) => updateDraft(row, { chatEnabled: v })}
                        onPrice={(v) => updateDraft(row, { chatPricePerMinute: v })}
                      />
                      <ModeRow
                        label="Call"
                        checked={draft.callEnabled}
                        price={draft.callPricePerMinute}
                        disabled={!canEdit}
                        onChecked={(v) => updateDraft(row, { callEnabled: v })}
                        onPrice={(v) => updateDraft(row, { callPricePerMinute: v })}
                      />
                      <ModeRow
                        label="Video"
                        checked={draft.videoEnabled}
                        price={draft.videoPricePerMinute}
                        disabled={!canEdit}
                        onChecked={(v) => updateDraft(row, { videoEnabled: v })}
                        onPrice={(v) => updateDraft(row, { videoPricePerMinute: v })}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="number"
                        value={draft.sortOrder}
                        disabled={!canEdit}
                        onChange={(e) => updateDraft(row, { sortOrder: e.target.value })}
                        aria-label="Sort order"
                        className={`${INPUT} w-20`}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={
                          paid
                            ? 'inline-flex rounded-full border border-warning-500/40 bg-warning-500/10 px-2.5 py-0.5 text-xs font-semibold text-warning-300'
                            : 'inline-flex rounded-full border border-success-500/40 bg-success-500/10 px-2.5 py-0.5 text-xs font-semibold text-success-400'
                        }
                      >
                        {paid ? 'Paid' : 'Free'}
                      </span>
                      <label className="mt-2 flex items-center gap-2 text-xs text-gray-300">
                        <input
                          type="checkbox"
                          checked={draft.enabled}
                          disabled={!canEdit}
                          onChange={(e) => updateDraft(row, { enabled: e.target.checked })}
                          className="h-4 w-4 accent-primary-600"
                        />
                        Visible to users
                      </label>
                    </td>
                    <td className="px-4 py-4">
                      {canEdit ? (
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void saveRow(row, draft)}
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-500 disabled:opacity-60"
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Save className="h-3.5 w-3.5" aria-hidden />
                            )}
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteRow(row)}
                            disabled={busy}
                            aria-label={`Delete ${row.label}`}
                            className="rounded-lg border border-danger-500/40 p-1.5 text-danger-400 hover:bg-danger-500/10 disabled:opacity-60"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </div>
                      ) : (
                        <p className="text-right text-xs text-gray-500">Activate to edit</p>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  )
}

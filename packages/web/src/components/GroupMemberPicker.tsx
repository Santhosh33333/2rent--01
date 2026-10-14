import { useCallback, useEffect, useState } from 'react'
import { Search, Users, X } from 'lucide-react'
import { api } from '../lib/api'
import { Avatar } from './Avatar'
import { Modal } from './ui'

interface Person {
  id: string
  fullName: string | null
  avatarUrl: string | null
}

interface GroupMemberPickerProps {
  open: boolean
  onClose: () => void
  onConfirm: (userIds: string[]) => void
  title?: string
  /** People already in the group — hidden so they cannot be selected again. */
  excludeIds?: string[]
  confirmLabel?: string
  busy?: boolean
}

/**
 * Search-and-select people, backed by the universal search endpoint
 * (`GET /search/search?filter=users`). Used both when creating a group and when
 * inviting people into an existing one, so the two flows pick people the same
 * way. Search is name-only and never returns phone numbers.
 */
export function GroupMemberPicker({
  open,
  onClose,
  onConfirm,
  title = 'Add people',
  excludeIds = [],
  confirmLabel = 'Add',
  busy = false,
}: GroupMemberPickerProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Person[]>([])
  const [selected, setSelected] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setSelected([])
    }
  }, [open])

  const runSearch = useCallback(
    async (q: string, signal?: AbortSignal) => {
      const term = q.trim()
      if (term.length < 2) {
        setResults([])
        return
      }
      setLoading(true)
      try {
        const res = await api.get('/search/search', {
          params: { q: term, filter: 'users', limit: 20 },
          signal,
        })
        const items = (res.data?.data?.results || []) as Array<{ type: string; id: string; title: string; imageUrl?: string }>
        const excluded = new Set(excludeIds)
        setResults(
          items
            .filter((r) => r.type === 'user' && !excluded.has(r.id))
            .map((r) => ({ id: r.id, fullName: r.title, avatarUrl: r.imageUrl || null })),
        )
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    },
    [excludeIds],
  )

  // Debounced search so each keystroke does not fire a request.
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => void runSearch(query, controller.signal), 300)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, open, runSearch])

  const toggle = (person: Person) => {
    setSelected((prev) =>
      prev.some((p) => p.id === person.id) ? prev.filter((p) => p.id !== person.id) : [...prev, person],
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="md"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || selected.length === 0}
            onClick={() => onConfirm(selected.map((p) => p.id))}
            className="btn btn-primary btn-sm"
          >
            {busy ? 'Working…' : `${confirmLabel}${selected.length ? ` (${selected.length})` : ''}`}
          </button>
        </>
      }
    >
      {selected.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {selected.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary-500/15 py-1 pl-1 pr-2 text-xs font-semibold text-primary-700 dark:text-primary-300"
            >
              <Avatar src={p.avatarUrl} name={p.fullName} className="h-6 w-6 rounded-full" textClassName="text-[10px]" />
              {p.fullName || 'Member'}
              <button type="button" onClick={() => toggle(p)} aria-label="Remove" className="text-primary-700/70 hover:text-primary-900 dark:text-primary-300/70">
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-400" />
        <input
          autoFocus
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search people by name…"
          className="input pl-10"
        />
      </div>

      <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
        {loading ? (
          <p className="px-2 py-6 text-center text-sm text-surface-400">Searching…</p>
        ) : query.trim().length < 2 ? (
          <p className="px-2 py-6 text-center text-sm text-surface-400">Type at least two letters of a name.</p>
        ) : results.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-surface-400">
            <Users className="mx-auto mb-2 h-5 w-5" />
            No one found with that name.
          </div>
        ) : (
          results.map((person) => {
            const isSelected = selected.some((p) => p.id === person.id)
            return (
              <button
                key={person.id}
                type="button"
                onClick={() => toggle(person)}
                className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2 text-left transition ${
                  isSelected ? 'bg-primary-500/10' : 'hover:bg-surface-50 dark:hover:bg-surface-800/60'
                }`}
              >
                <Avatar src={person.avatarUrl} name={person.fullName} className="h-10 w-10 rounded-2xl" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-surface-900 dark:text-white">
                  {person.fullName || 'Nabri member'}
                </span>
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full border ${
                    isSelected
                      ? 'border-primary-500 bg-primary-500 text-white'
                      : 'border-surface-300 dark:border-surface-600'
                  }`}
                >
                  {isSelected && <span className="text-[11px] leading-none">✓</span>}
                </span>
              </button>
            )
          })
        )}
      </div>
    </Modal>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ChevronRight, GripVertical, Search, SlidersHorizontal, Sparkles } from 'lucide-react'
import { DISCOVERY_CATEGORIES, QUICK_ACTIONS, type DiscoveryCategoryKey } from '../../lib/discoveryData'

const STORAGE_KEY = 'rentbuddy.discovery-order'

export function DiscoveryHubPage() {
  const [query, setQuery] = useState('')
  const [customOrder, setCustomOrder] = useState<DiscoveryCategoryKey[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        return JSON.parse(saved) as DiscoveryCategoryKey[]
      } catch {
        return []
      }
    }
    return DISCOVERY_CATEGORIES.map((category) => category.key)
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(customOrder))
  }, [customOrder])

  const orderedCategories = useMemo(() => {
    const map = new Map(DISCOVERY_CATEGORIES.map((category) => [category.key, category]))
    return customOrder
      .map((key) => map.get(key))
      .filter(Boolean) as typeof DISCOVERY_CATEGORIES
  }, [customOrder])

  const filteredCategories = orderedCategories.filter((category) => {
    const haystack = `${category.label} ${category.summary}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  const moveCategory = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= customOrder.length) return
    const updated = [...customOrder]
    ;[updated[index], updated[nextIndex]] = [updated[nextIndex], updated[index]]
    setCustomOrder(updated)
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-primary-500 font-semibold">Discover</p>
          <h1 className="text-2xl font-bold tracking-tight">Explore your ecosystem</h1>
        </div>
        <Link to="/search" className="inline-flex items-center gap-2 rounded-xl bg-primary-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-primary-500/25">
          <Search className="w-4 h-4" />
          Search
        </Link>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search categories, activities, and communities..."
          className="input pl-12 py-3.5"
        />
      </div>

      <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="mb-3 flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary-500" />
          <h2 className="font-semibold">Quick actions</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((action) => (
            <Link key={action.key} to={action.route} className="rounded-full bg-surface-100 px-3 py-2 text-sm font-medium text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700">
              {action.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            <h2 className="font-semibold">Customize category order</h2>
          </div>
          <span className="text-xs text-surface-500">Pinned first</span>
        </div>

        <div className="space-y-2">
          {filteredCategories.map((category) => (
            <div key={category.key} className="flex items-center gap-3 rounded-2xl border border-surface-200 bg-surface-50 p-3 dark:border-surface-700 dark:bg-surface-800/60">
              <GripVertical className="w-4 h-4 text-surface-400" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <category.icon className="w-4 h-4 text-primary-500" />
                  <span className="font-medium">{category.label}</span>
                </div>
                <p className="mt-1 text-xs text-surface-500">{category.summary}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => moveCategory(customOrder.indexOf(category.key), -1)} className="rounded-lg bg-surface-100 px-2 py-1 text-xs dark:bg-surface-700">↑</button>
                <button onClick={() => moveCategory(customOrder.indexOf(category.key), 1)} className="rounded-lg bg-surface-100 px-2 py-1 text-xs dark:bg-surface-700">↓</button>
                <Link to={`/discover/${category.key}`} className="ml-2 inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white">
                  Open <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {filteredCategories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-surface-300 p-6 text-center text-sm text-surface-500">
            No category matches this search.
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredCategories.map((category) => (
          <Link key={category.key} to={`/discover/${category.key}`} className="group rounded-3xl border border-surface-200 bg-white p-4 shadow-sm transition hover:-translate-y-1 hover:shadow-md dark:border-surface-800 dark:bg-surface-900">
            <div className={`inline-flex rounded-2xl bg-gradient-to-br ${category.accent} p-3 text-white`}>
              <category.icon className="w-5 h-5" />
            </div>
            <h3 className="mt-4 text-lg font-semibold">{category.label}</h3>
            <p className="mt-2 text-sm text-surface-600 dark:text-surface-300">{category.summary}</p>
            <div className="mt-4 flex items-center justify-between text-sm font-medium text-primary-600 dark:text-primary-400">
              <span>Open section</span>
              <ChevronRight className="w-4 h-4 transition group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { ArrowLeft, ChevronRight, Search, ShieldCheck, Sparkles, User as UserIcon } from 'lucide-react'
import { DISCOVERY_BY_KEY, type DiscoveryCategoryKey } from '../lib/discoveryData'
import { api } from '../lib/api'

interface DiscoveryCategoryPageProps {
  categoryKey: DiscoveryCategoryKey
}

interface Person {
  id: string
  name: string
  avatarUrl?: string | null
  city?: string | null
  bio?: string | null
  gender?: string
  dateOfBirth?: string
  joinedAt?: string
}

function ageFrom(dob?: string): number | null {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  const age = Math.floor(diff / (365.25 * 24 * 3600 * 1000))
  return age > 0 && age < 130 ? age : null
}

export function DiscoveryCategoryPage({ categoryKey }: DiscoveryCategoryPageProps) {
  const navigate = useNavigate()
  const [searchQuery, setSearchQuery] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [loading, setLoading] = useState(false)
  const category = DISCOVERY_BY_KEY[categoryKey]
  const showsPeople = categoryKey === 'dating' || categoryKey === 'movies'

  useEffect(() => {
    if (!showsPeople) return
    let active = true
    setLoading(true)
    api
      .get('/discovery/people', { params: { category: categoryKey, limit: 30 } })
      .then((res) => {
        if (active && res.data?.success) setPeople(res.data.data.people || [])
      })
      .catch(() => {
        if (active) setPeople([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [categoryKey, showsPeople])

  if (!category) {
    return (
      <div className="space-y-6 p-4">
        <button onClick={() => navigate('/discover')} className="btn btn-secondary btn-sm">Back to Discover</button>
        <div className="rounded-3xl border border-dashed border-surface-300 p-8 text-center text-surface-500">
          This category is not available yet.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/discover')} className="p-2 rounded-xl bg-surface-100 hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700 transition">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-[0.2em] text-primary-500 font-semibold">Discover</p>
          <h1 className="text-2xl font-bold tracking-tight">{category.label}</h1>
        </div>
      </div>

      <div className={`rounded-3xl bg-gradient-to-br ${category.accent} p-5 text-white shadow-lg`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-white/80">{category.volume}</p>
            <h2 className="mt-2 text-xl font-bold">{category.summary}</h2>
          </div>
          <div className="p-3 rounded-2xl bg-white/10 backdrop-blur-sm">
            <category.icon className="w-6 h-6" />
          </div>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchQuery.trim()) {
              navigate(`/search?q=${encodeURIComponent(searchQuery.trim())}`)
            }
          }}
          placeholder={`Search ${category.label.toLowerCase()}...`}
          className="input pl-12 py-3.5"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {category.filters.map((filter) => (
          <button key={filter} className="px-3 py-2 rounded-full bg-surface-100 text-xs font-medium text-surface-700 dark:bg-surface-800 dark:text-surface-200">
            {filter}
          </button>
        ))}
      </div>

      {showsPeople ? (
        loading ? (
          <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-50 p-8 text-center dark:border-surface-700 dark:bg-surface-900">
            <p className="text-sm text-surface-500">Loading real {category.label.toLowerCase()} near you…</p>
          </div>
        ) : people.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {people.map((p) => (
              <div key={p.id} className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
                <div className="flex items-start gap-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt={p.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-surface-500">
                        <UserIcon className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-surface-900 dark:text-white">{p.name}</p>
                    <p className="text-xs text-surface-500">
                      {[p.city, ageFrom(p.dateOfBirth) ? `${ageFrom(p.dateOfBirth)} yrs` : null].filter(Boolean).join(' · ') || 'RentBuddy member'}
                    </p>
                  </div>
                </div>
                {p.bio && <p className="mt-3 text-sm text-surface-600 dark:text-surface-300 line-clamp-2">{p.bio}</p>}
                <div className="mt-4 flex items-center justify-between text-xs text-surface-500">
                  <span>RentBuddy member</span>
                  <button
                    onClick={() => navigate(`/messages?user=${p.id}`)}
                    className="inline-flex items-center gap-1 font-medium text-primary-600 dark:text-primary-400"
                  >
                    Message <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-50 p-8 text-center dark:border-surface-700 dark:bg-surface-900">
            <p className="text-sm font-medium text-surface-700 dark:text-surface-200">No members found yet</p>
            <p className="mt-1 text-xs text-surface-500">
              Real {category.label.toLowerCase()} members will appear here as they join. No demo profiles are shown.
            </p>
          </div>
        )
      ) : category.recommendations.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {category.recommendations.map((item) => (
            <div key={item.id} className="rounded-3xl border border-surface-200 bg-white p-4 shadow-sm dark:border-surface-800 dark:bg-surface-900">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-surface-900 dark:text-white">{item.title}</p>
                  <p className="text-xs text-surface-500">{item.subtitle}</p>
                </div>
                {item.badge && (
                  <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {item.badge}
                  </span>
                )}
              </div>
              <p className="mt-3 text-sm text-surface-600 dark:text-surface-300">{item.details}</p>
              <div className="mt-4 flex items-center justify-between text-xs text-surface-500">
                <span>{item.meta}</span>
                <button className="inline-flex items-center gap-1 font-medium text-primary-600 dark:text-primary-400">
                  View <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-surface-300 bg-surface-50 p-8 text-center dark:border-surface-700 dark:bg-surface-900">
          <p className="text-sm font-medium text-surface-700 dark:text-surface-200">No live recommendations yet</p>
          <p className="mt-1 text-xs text-surface-500">
            Real {category.label.toLowerCase()} activity will appear here once it is available from the platform. No demo profiles are shown.
          </p>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h3 className="font-semibold">Safety rules</h3>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-surface-600 dark:text-surface-300">
            {category.safetyRules.map((rule) => (
              <li key={rule} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-3xl border border-surface-200 bg-white p-5 dark:border-surface-800 dark:bg-surface-900">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            <h3 className="font-semibold">Suggested workflow</h3>
          </div>
          <ol className="mt-4 space-y-3 text-sm text-surface-600 dark:text-surface-300">
            {category.workflow.map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-100 text-[10px] font-bold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      <div className="rounded-3xl border border-dashed border-primary-200 bg-primary-50 p-4 text-sm text-primary-700 dark:border-primary-800 dark:bg-primary-950/20 dark:text-primary-200">
        AI recommendations are shown as suggestions, not guarantees. They explain why a match or activity may be relevant based on shared interests, lifestyle, and timing.
      </div>
    </div>
  )
}

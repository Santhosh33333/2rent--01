import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Search, Users, Calendar, MessageCircle, Footprints, Sparkles, X, Clock, ChevronLeft, ChevronRight } from 'lucide-react'
import { api, assetUrl } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/EmptyState'
import { SkeletonLoader } from '../../components/SkeletonLoader'
import { useAsync } from '../../hooks/useAsync'

interface SearchResult {
  type: 'user' | 'partner' | 'event' | 'community' | 'booking'
  id: number | string
  title: string
  subtitle?: string
  description?: string
  imageUrl?: string
  link?: string
  metadata?: Record<string, any>
}

interface TrendingData {
  communities: Array<{ id: number; name: string; category?: string }>
  events: Array<{ id: number; name: string; date: string }>
}

interface PaginationData {
  results: SearchResult[]
  total: number
  page: number
  limit: number
  pages: number
}

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const query = searchParams.get('q') || ''
  const filter = searchParams.get('filter') || 'all'
  const page = Number(searchParams.get('page')) || 1
  const limit = Number(searchParams.get('limit')) || 20

  const [localQuery, setLocalQuery] = useState(query)
  const [results, setResults] = useState<SearchResult[]>([])
  const [paginationData, setPaginationData] = useState<PaginationData | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [trending, setTrending] = useState<TrendingData | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)

  // Fetch search results with pagination
  const { loading: searchLoading, error: searchError, retry: retrySearch } = useAsync(
    async () => {
      if (!query || query.length < 2) {
        setResults([])
        setPaginationData(null)
        return null
      }
      const res = await api.get('/search', {
        params: { q: query, filter, page, limit }
      })
      const data = res.data?.data || {}
      setResults(data.results || [])
      setPaginationData({
        results: data.results || [],
        total: data.total || 0,
        page: data.page || 1,
        limit: data.limit || limit,
        pages: data.pages || 0
      })
      return data
    },
    !!query,
    { immediate: false }
  )

  // Fetch trending on mount
  const { loading: trendingLoading } = useAsync(
    async () => {
      const res = await api.get('/search/trending')
      const data = res.data?.data || {}
      setTrending(data)
      return data
    },
    !query,
    { immediate: true }
  )

  // Fetch suggestions
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (localQuery.length >= 2) {
        try {
          const res = await api.get('/search/suggest', {
            params: { q: localQuery }
          })
          setSuggestions(res.data?.data?.suggestions || [])
          setShowSuggestions(true)
        } catch (error) {
          setSuggestions([])
        }
      } else {
        setSuggestions([])
        setShowSuggestions(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [localQuery])

  // Trigger search when query/filter/page changes
  useEffect(() => {
    if (query && query.length >= 2) {
      retrySearch()
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [query, filter, page])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (localQuery.length >= 2) {
      setSearchParams({ q: localQuery, filter, page: '1', limit: String(limit) })
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (suggestion: string) => {
    setLocalQuery(suggestion)
    setSearchParams({ q: suggestion, filter, page: '1', limit: String(limit) })
    setShowSuggestions(false)
  }

  const handleFilterChange = (newFilter: string) => {
    setSearchParams({ q: query, filter: newFilter, page: '1', limit: String(limit) })
  }

  const handleLimitChange = (newLimit: number) => {
    setSearchParams({ q: query, filter, page: '1', limit: String(newLimit) })
  }

  const handlePageChange = (newPage: number) => {
    if (paginationData && newPage >= 1 && newPage <= paginationData.pages) {
      setSearchParams({ q: query, filter, page: String(newPage), limit: String(limit) })
    }
  }

  const handleClearSearch = () => {
    setLocalQuery('')
    setResults([])
    setSuggestions([])
    setShowSuggestions(false)
    setPaginationData(null)
    setSearchParams({})
    navigate('/search')
  }

  const getResultIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'user':
        return <Users className="w-5 h-5" />
      case 'partner':
        return <Users className="w-5 h-5 text-primary-500" />
      case 'event':
        return <Calendar className="w-5 h-5 text-amber-500" />
      case 'community':
        return <MessageCircle className="w-5 h-5 text-sky-500" />
      case 'booking':
        return <Footprints className="w-5 h-5 text-emerald-500" />
      default:
        return <Search className="w-5 h-5" />
    }
  }

  const getResultTypeLabel = (type: SearchResult['type']) => {
    return type.charAt(0).toUpperCase() + type.slice(1)
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title={query ? `Search Results for "${query}"` : 'Search'} 
        subtitle={query ? `Found ${paginationData?.total || 0} result${(paginationData?.total || 0) !== 1 ? 's' : ''}` : 'Find users, events, communities, and more'} 
      />

      <AnimatedPage delay={50}>
        <form onSubmit={handleSearch} className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-surface-400" />
          <input
            type="text"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onFocus={() => localQuery.length >= 2 && setShowSuggestions(true)}
            placeholder="Search users, events, communities..."
            className="input pl-12 py-3.5 pr-10"
          />
          {localQuery && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-1 hover:bg-surface-100 dark:hover:bg-surface-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-surface-400" />
            </button>
          )}

          {/* Autocomplete Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-2 bg-white dark:bg-surface-900 border border-surface-200 dark:border-surface-700 rounded-2xl shadow-lg z-10">
              <div className="p-2 space-y-1">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="w-full flex items-center gap-3 px-4 py-2 rounded-xl hover:bg-surface-50 dark:hover:bg-surface-800 transition-colors text-left"
                  >
                    <Search className="w-4 h-4 text-surface-400" />
                    <span className="text-sm text-surface-600 dark:text-surface-300">{suggestion}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
      </AnimatedPage>

      {/* Filter Tabs */}
      {query && (
        <AnimatedPage delay={75}>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {['all', 'users', 'partners', 'events', 'communities', 'bookings'].map(f => (
              <button
                key={f}
                onClick={() => handleFilterChange(f)}
                className={`px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
                  filter === f
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-500/25'
                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700'
                }`}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </AnimatedPage>
      )}

      <AnimatedPage delay={100}>
        {query ? (
          // Search Results
          <>
            {searchLoading ? (
              <SkeletonLoader lines={8} variant="list" />
            ) : searchError ? (
              <EmptyState
                icon={Search}
                title="Search failed"
                description="Please check your connection and try again"
                action={<button onClick={retrySearch} className="btn btn-primary btn-sm">Retry</button>}
              />
            ) : !results || results.length === 0 ? (
              <EmptyState
                icon={Search}
                title="No results found"
                description={`No ${filter === 'all' ? '' : filter} match your search "${query}"`}
                action={<button onClick={handleClearSearch} className="btn btn-primary btn-sm">Clear Search</button>}
              />
            ) : (
              <>
                <div className="space-y-3">
                  {results.map((result) => (
                    <a
                      key={`${result.type}-${result.id}`}
                      href={result.link}
                      className="glass-card p-4 flex items-start gap-4 group hover:-translate-y-0.5 transition-all duration-300 block"
                    >
                      {/* Icon */}
                      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-surface-100 dark:bg-surface-800 flex items-center justify-center text-surface-600 dark:text-surface-400 group-hover:scale-110 transition-transform">
                        {result.imageUrl ? (
                          <img src={assetUrl(result.imageUrl) || ''} alt={result.title} className="w-full h-full rounded-xl object-cover" />
                        ) : (
                          getResultIcon(result.type)
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h3 className="font-bold text-surface-900 dark:text-white truncate">
                            {result.title}
                          </h3>
                          <span className="text-[10px] px-2 py-1 rounded-full bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 flex-shrink-0 font-medium">
                            {getResultTypeLabel(result.type)}
                          </span>
                        </div>

                        {result.subtitle && (
                          <p className="text-sm text-surface-500 dark:text-surface-400 truncate mb-1">
                            {result.subtitle}
                          </p>
                        )}

                        {result.description && (
                          <p className="text-sm text-surface-600 dark:text-surface-300 line-clamp-2">
                            {result.description}
                          </p>
                        )}
                      </div>
                    </a>
                  ))}
                </div>

                {/* Pagination */}
                {paginationData && paginationData.pages > 1 && (
                  <div className="mt-8 pt-6 border-t border-surface-200 dark:border-surface-700 space-y-4">
                    {/* Results per page */}
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-surface-600 dark:text-surface-400">
                        Showing {((paginationData.page - 1) * paginationData.limit) + 1}-{Math.min(paginationData.page * paginationData.limit, paginationData.total)} of {paginationData.total}
                      </p>
                      <div className="flex gap-2">
                        {[10, 20, 50].map(size => (
                          <button
                            key={size}
                            onClick={() => handleLimitChange(size)}
                            className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                              limit === size
                                ? 'bg-primary-600 text-white'
                                : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200'
                            }`}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Pagination buttons */}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        onClick={() => handlePageChange(page - 1)}
                        disabled={page <= 1}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        <ChevronLeft className="w-4 h-4" />
                        <span className="text-sm">Previous</span>
                      </button>

                      {/* Page indicators */}
                      <div className="flex items-center gap-1">
                        {Array.from({ length: Math.min(5, paginationData.pages) }, (_, i) => {
                          let pageNum = page + i - 2
                          if (pageNum < 1) pageNum = 1 + i
                          if (pageNum > paginationData.pages) pageNum = paginationData.pages - 4 + i
                          
                          return (
                            pageNum > 0 && pageNum <= paginationData.pages && (
                              <button
                                key={pageNum}
                                onClick={() => handlePageChange(pageNum)}
                                className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                                  pageNum === page
                                    ? 'bg-primary-600 text-white'
                                    : 'bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200'
                                }`}
                              >
                                {pageNum}
                              </button>
                            )
                          )
                        })}
                      </div>

                      <button
                        onClick={() => handlePageChange(page + 1)}
                        disabled={page >= paginationData.pages}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-100 dark:bg-surface-800 text-surface-600 dark:text-surface-400 hover:bg-surface-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        <span className="text-sm">Next</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          // Trending
          <>
            {trendingLoading ? (
              <SkeletonLoader lines={5} variant="list" />
            ) : trending ? (
              <div className="space-y-8">
                {/* Trending Communities */}
                {trending.communities && trending.communities.length > 0 && (
                  <div>
                    <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-4 flex items-center gap-2">
                      <Sparkles className="w-5 h-5 text-primary-500" />
                      Trending Communities
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {trending.communities.map(c => (
                        <a
                          key={c.id}
                          href={`/communities/${c.id}`}
                          className="glass-card p-4 group hover:-translate-y-0.5 transition-all duration-300 block"
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                              <MessageCircle className="w-5 h-5 text-white" />
                            </div>
                            <div className="min-w-0">
                              <h3 className="font-bold text-surface-900 dark:text-white truncate">{c.name}</h3>
                              {c.category && <p className="text-xs text-surface-500 mt-0.5">{c.category}</p>}
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Trending Events */}
                {trending.events && trending.events.length > 0 && (
                  <div>
                    <h2 className="text-lg font-bold text-surface-900 dark:text-white mb-4 flex items-center gap-2">
                      <Calendar className="w-5 h-5 text-amber-500" />
                      Upcoming Events
                    </h2>
                    <div className="space-y-3">
                      {trending.events.map(e => (
                        <a
                          key={e.id}
                          href={`/events/${e.id}`}
                          className="glass-card p-4 flex items-start gap-3 group hover:-translate-y-0.5 transition-all duration-300 block"
                        >
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                            <Calendar className="w-5 h-5 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-surface-900 dark:text-white truncate">{e.name}</h3>
                            <p className="text-xs text-surface-500 mt-0.5 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(e.date).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })}
                            </p>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </>
        )}
      </AnimatedPage>
    </div>
  )
}

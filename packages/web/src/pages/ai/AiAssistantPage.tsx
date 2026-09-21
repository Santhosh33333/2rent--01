import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Loader2, Send, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { api } from '../../lib/api'
import { AnimatedPage } from '../../components/AnimatedPage'
import { PageHeader } from '../../components/PageHeader'
import { getErrorMessage } from '../../lib/error'

interface AiAction {
  type: string
  label: string
  route: string
}

interface AiAnswer {
  intent: string
  reply: string
  results: any
  actions: AiAction[]
}

const SUGGESTIONS = [
  'Something to do near me tomorrow evening',
  'Find sports games this week',
  'Any movie meetups?',
  'Available partners near me',
  'My bookings status',
]

function ResultList({ answer }: { answer: AiAnswer }) {
  const items: any[] = Array.isArray(answer.results)
    ? answer.results
    : Array.isArray(answer.results?.partners)
      ? answer.results.partners
      : []
  if (items.length === 0) return null
  return (
    <div className="mt-3 space-y-2">
      {items.slice(0, 5).map((it: any) => {
        const id = it.id
        const title = it.title || it.name || 'Item'
        const sub =
          it.startTime || it.date
            ? format(new Date(it.startTime || it.date), 'MMM d, h:mm a')
            : it.city || it.services?.join(' + ') || ''
        const link =
          answer.intent === 'events' || answer.intent === 'sports' || answer.intent === 'movies'
            ? `/events/${id}`
            : answer.intent === 'communities'
              ? `/communities/${id}`
              : answer.intent === 'bookings'
                ? `/bookings/${id}`
                : null
        const body = (
          <>
            <p className="text-sm font-semibold truncate">{title}</p>
            {sub && <p className="text-xs text-surface-500">{String(sub)}</p>}
          </>
        )
        return link ? (
          <Link key={id} to={link} className="block rounded-2xl border border-surface-200 p-3 dark:border-surface-700 hover:border-primary-300 transition-colors">
            {body}
          </Link>
        ) : (
          <div key={id} className="rounded-2xl border border-surface-200 p-3 dark:border-surface-700">
            {body}
          </div>
        )
      })}
    </div>
  )
}

export function AiAssistantPage() {
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Array<{ q: string; a: AiAnswer }>>([])

  const ask = async (text: string) => {
    const q = text.trim()
    if (q.length < 2 || asking) return
    setAsking(true)
    setError(null)
    try {
      let lat: number | undefined
      let lon: number | undefined
      try {
        const cached = localStorage.getItem('Sidebud-geo-fix')
        if (cached) {
          const fix = JSON.parse(cached)
          if (Date.now() - fix.ts < 10 * 60 * 1000) {
            lat = fix.lat
            lon = fix.lon
          }
        }
      } catch {
        // location optional — assistant works without it
      }
      const res = await api.post('/ai/ask', { message: q, lat, lon })
      const data = res.data?.data || res.data
      setHistory((h) => [{ q, a: data }, ...h].slice(0, 20))
      setInput('')
    } catch (err) {
      setError(getErrorMessage(err, 'Assistant is unavailable right now.'))
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="SideBud AI" subtitle="Real answers from live platform data — never invented" />

      <AnimatedPage>
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-500 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <p className="text-sm text-surface-500">Ask about events, sports, movies, partners, communities or bookings.</p>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              ask(input)
            }}
            className="flex items-end gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Try "something to do near me tomorrow evening"'
              className="input flex-1"
              maxLength={500}
            />
            <button type="submit" disabled={asking || input.trim().length < 2} className="btn-gradient btn-icon-lg shrink-0 disabled:opacity-50" aria-label="Ask">
              {asking ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </form>
          <div className="flex flex-wrap gap-2 mt-3">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => ask(s)}
                disabled={asking}
                className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700 disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm text-danger-500">{error}</p>}
        </div>
      </AnimatedPage>

      {history.map((h, i) => (
        <AnimatedPage key={`${i}-${h.q}`} delay={Math.min(i * 50, 200)}>
          <div className="glass-card p-5">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">{h.q}</p>
            <p className="mt-2 text-sm text-surface-600 dark:text-surface-300 flex items-start gap-1.5">
              <Sparkles className="w-4 h-4 mt-0.5 shrink-0 text-violet-500" />
              <span>{h.a.reply}</span>
            </p>
            <ResultList answer={h.a} />
            {h.a.actions?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {h.a.actions.map((a) => (
                  <Link key={a.route} to={a.route} className="rounded-xl bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white">
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </AnimatedPage>
      ))}
    </div>
  )
}

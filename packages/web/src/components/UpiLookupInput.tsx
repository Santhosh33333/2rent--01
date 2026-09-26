import { useState } from 'react'
import { Search, Loader2, CheckCircle2, AlertTriangle, HelpCircle, User } from 'lucide-react'
import { api } from '../lib/api'
import toast from 'react-hot-toast'

interface LookupResult {
  kind: 'VPA' | 'PHONE' | 'INVALID'
  upiId: string | null
  phone: string | null
  name: string | null
  nameSource: 'gateway' | 'handle' | 'configured' | 'none'
  verified: boolean
  exists: boolean | null
  bank: string | null
  message: string
}

/**
 * UPI ID / phone number checker.
 *
 * Resolves what can actually be resolved: a VPA is checked at the bank when the
 * server has live gateway credentials, otherwise only its format and handle are
 * read. A phone number is never resolved to a name, because no UPI service
 * exposes that mapping - the UI says so instead of inventing a name.
 */
export function UpiLookupInput() {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<LookupResult | null>(null)

  const runLookup = async () => {
    const value = query.trim()
    if (value.length < 2) {
      toast.error('Enter a UPI ID or a 10-digit phone number.')
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await api.post('/payments/lookup-upi', { query: value })
      setResult((res.data?.data || res.data) as LookupResult)
    } catch (err: any) {
      const message = err?.response?.data?.message || err?.response?.data?.error || 'Lookup failed. Please try again.'
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  const tone = (() => {
    if (!result) return null
    if (result.kind === 'PHONE') return 'amber'
    if (result.verified) return 'emerald'
    if (result.name) return 'sky'
    return 'slate'
  })()

  const Icon = (() => {
    if (!result) return User
    if (result.kind === 'PHONE') return HelpCircle
    if (result.verified) return CheckCircle2
    if (result.name) return AlertTriangle
    return HelpCircle
  })()

  return (
    <div className="space-y-2">
      <label className="text-xs font-semibold text-surface-600 dark:text-surface-300">
        Check a UPI ID or phone number before paying
      </label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setResult(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void runLookup()
          }}
          placeholder="name@bank or 10-digit phone"
          className="input flex-1"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button
          onClick={() => void runLookup()}
          disabled={loading}
          className="btn-gradient px-4 flex items-center gap-1.5 disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Check
        </button>
      </div>

      {result && tone && (
        <div
          className={`p-3 rounded-xl text-xs border ${
            tone === 'emerald'
              ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : tone === 'sky'
                ? 'bg-sky-50 dark:bg-sky-900/20 border-sky-200 dark:border-sky-800 text-sky-800 dark:text-sky-300'
                : tone === 'amber'
                  ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300'
                  : 'bg-surface-50 dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-600 dark:text-surface-300'
          }`}
        >
          <p className="flex items-start gap-1.5 font-medium">
            <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              {result.name ? (
                <>
                  Name: <span className="font-bold">{result.name}</span>
                  {result.verified ? ' (verified at bank)' : ' (not confirmed with bank)'}
                </>
              ) : (
                result.message
              )}
            </span>
          </p>
          <p className="mt-1 opacity-80">{result.message}</p>
          {result.bank && (
            <p className="mt-1 opacity-80">
              Bank/app handle: <span className="font-mono">{result.bank}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { Copy, Gift, Check, Users, Sparkles, TriangleAlert } from 'lucide-react'
import { api } from '../../lib/api'
import { Tilt } from '../motion/Tilt'
import { getErrorMessage } from '../../lib/error'

/**
 * Where a code typed at registration is parked when it could not be applied, so
 * the user can retry it here instead of the referral being lost silently. The
 * backend refuses a second apply once one has succeeded (ALREADY_REFERRED), so
 * this only ever appears for a code that genuinely did not go through.
 */
const PENDING_KEY = 'pending_referral_code'

export function stashPendingReferralCode(code: string): void {
  try {
    localStorage.setItem(PENDING_KEY, code)
  } catch {
    /* private mode: the retry affordance is a nicety, not a requirement */
  }
}

export function clearPendingReferralCode(): void {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * Invite friends.
 *
 * The backend already issues a deterministic per-user code and settles rewards
 * on the referee's first completed booking; none of it was reachable from the
 * app, so a user could never share their own code or see whether a reward had
 * landed. This is the surface for that.
 *
 * Rewards are shown as counts rather than rupee amounts on purpose: the amounts
 * are decided by config on the server, and hardcoding them here would show a
 * number that can silently disagree with what is actually paid.
 */

interface ReferralProfile {
  code: string
  stats: { invited: number; completed: number }
}

const SHARE_TEXT = (code: string) =>
  `Join me on Nabri — people nearby for walks, events, dating and more. Use my code ${code} when you sign up.`

export function ReferralCard({ className = '' }: { className?: string }) {
  const [profile, setProfile] = useState<ReferralProfile | null>(null)
  const [copied, setCopied] = useState(false)
const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/referrals/me')
      const d = res.data?.data
      if (d?.code) setProfile({ code: d.code, stats: d.stats ?? { invited: 0, completed: 0 } })
    } catch {
      setError('Could not load your referral code.')
    } finally {
      setLoading(false)
    }
  }, [])

  // Surface a code that failed at registration, if there is one.
  useEffect(() => {
    try {
      const parked = localStorage.getItem(PENDING_KEY)
      if (parked) setPendingCode(parked)
    } catch {
      /* ignore */
    }
  }, [])

  const retryPending = async () => {
    if (!pendingCode) return
    setApplying(true)
    setError(null)
    try {
      await api.post('/referrals/apply', { code: pendingCode })
      clearPendingReferralCode()
      setPendingCode(null)
      // The referrer's count is unchanged, but re-read so nothing is stale.
      await load()
    } catch (err: unknown) {
      setError(getErrorMessage(err) || 'That code still cannot be applied.')
    } finally {
      setApplying(false)
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  const copy = async () => {
    if (!profile?.code) return
    try {
      await navigator.clipboard.writeText(profile.code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Could not copy. Select the code and copy it manually.')
    }
  }

  const share = async () => {
    if (!profile?.code) return
    const text = SHARE_TEXT(profile.code)
    const url = `${window.location.origin}/register?ref=${encodeURIComponent(profile.code)}`
    // Native share sheet on mobile, clipboard elsewhere.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Join me on Nabri', text, url })
        return
      } catch {
        // The user dismissed the sheet, or it failed: fall through to copy.
      }
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2200)
    } catch {
      setError('Could not share. Copy the code and send it yourself.')
    }
  }

  if (loading) {
    return (
      <section aria-label="Invite friends" className={`prism-card prism-ring p-5 ${className}`}>
        <div className="skeleton h-5 w-40" />
        <div className="skeleton mt-3 h-10 w-full" />
      </section>
    )
  }

  if (!profile) {
    return (
      <section aria-label="Invite friends" className={`prism-card prism-ring p-5 ${className}`}>
        <p className="text-sm text-surface-500 dark:text-surface-400">
          {error ?? 'Referrals are not available right now.'}
        </p>
      </section>
    )
  }

  const { invited, completed } = profile.stats

  return (
    <section aria-label="Invite friends" className={`prism-card prism-ring p-1 ${className}`}>
      <div className="relative rounded-[calc(1.5rem-1px)] p-5">
        <div className="prism-aurora animate-prism-drift opacity-50" aria-hidden />

        <div className="relative z-10">
          <div className="mb-4 flex items-center gap-3">
            <span className="prism-chip h-10 w-10 text-white shadow-lg shadow-violet-500/20">
              <Gift className="h-[18px] w-[18px]" aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold font-display text-surface-900 dark:text-white">
                Invite friends
              </h2>
              <p className="text-xs text-surface-500 dark:text-surface-400">
                Rewards unlock after their first completed booking.
              </p>
            </div>
          </div>

          {/* The code is the point of this screen, so it is the largest element. */}
          <div className="mb-4 flex items-center justify-between gap-3 rounded-2xl bg-white/70 p-4 dark:bg-surface-800/50">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                Your code
              </p>
              <p className="prism-text select-all font-display text-2xl font-bold tracking-tight">
                {profile.code}
              </p>
            </div>
            <button
              type="button"
              onClick={copy}
              aria-label={copied ? 'Code copied' : 'Copy referral code'}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-900 text-white transition active:scale-95 dark:bg-white dark:text-surface-900"
            >
              {copied ? <Check className="h-5 w-5" aria-hidden /> : <Copy className="h-5 w-5" aria-hidden />}
            </button>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-white/60 px-3 py-2.5 dark:bg-surface-800/40">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-surface-500 dark:text-surface-400">
                <Users className="h-3.5 w-3.5" aria-hidden />
                Invited
              </p>
              <p className="font-display text-xl font-bold text-surface-900 dark:text-white">{invited}</p>
            </div>
            <div className="rounded-2xl bg-white/60 px-3 py-2.5 dark:bg-surface-800/40">
              <p className="flex items-center gap-1.5 text-[11px] font-medium text-surface-500 dark:text-surface-400">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Rewards earned
              </p>
              <p className="font-display text-xl font-bold text-surface-900 dark:text-white">{completed}</p>
            </div>
          </div>

          {pendingCode && (
            <div className="mb-4 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3.5">
              <p className="flex items-start gap-2 text-xs font-medium text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
                <span>
                  The referral code{' '}
                  <span className="font-mono font-bold">{pendingCode}</span> you entered at sign-up
                  did not apply. Check it with your friend, or enter another below.
                </span>
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={retryPending}
                  disabled={applying}
                  className="rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white transition active:scale-[0.98] disabled:opacity-50"
                >
                  {applying ? 'Retrying…' : 'Retry this code'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearPendingReferralCode()
                    setPendingCode(null)
                  }}
                  className="rounded-xl px-3 py-2 text-xs font-semibold text-surface-600 transition hover:text-surface-900 dark:text-surface-400 dark:hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {error && <p className="mb-3 text-xs font-medium text-amber-600 dark:text-amber-400">{error}</p>}

          <Tilt max={6} lift={10} scale={1.01}>
            <button
              type="button"
              onClick={share}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-500/25 transition active:scale-[0.98]"
            >
              <Gift className="h-4 w-4" aria-hidden />
              Share your code
            </button>
          </Tilt>
        </div>
      </div>
    </section>
  )
}
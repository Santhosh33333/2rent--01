import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { legalApi } from '../../lib/api'
import { Scale, AlertTriangle } from 'lucide-react'

export interface ReConsentState {
  satisfied: boolean
  required: boolean
  notifiedAt: string | null
  graceDays: number
  graceEndsAt: string | null
  graceExpired: boolean
  daysRemaining: number
  missing: string[]
  blocking: boolean
}

/**
 * Notice banner for accounts created before the consent gate shipped.
 *
 * Deliberately non-blocking in the UI. The server is the enforcement point and
 * it only refuses once the grace window has lapsed; a banner that screamed at
 * someone on day one would be a deadline they were never shown. So this stays
 * calm, states the real remaining days, and gets out of the way.
 */
export function ReConsentBanner() {
  const [state, setState] = useState<ReConsentState | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await legalApi.reConsent()
      const payload = res.data?.data?.reConsent ?? null
      setState(payload)
    } catch {
      // A failed lookup must never block the app. Absence of the notice is the
      // safe default: the server still enforces whatever is actually owed.
      setState(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!state || !state.required) return null

  const urgent = state.blocking

  return (
    <div
      role="status"
      className={[
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-4 py-3 text-sm',
        urgent
          ? 'border-danger-500/40 bg-danger-500/10 text-danger-700 dark:text-danger-300'
          : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200',
      ].join(' ')}
    >
      {urgent ? (
        <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden="true" />
      ) : (
        <Scale className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {urgent
            ? 'Please review and accept the updated terms'
            : 'Please review our updated terms'}
        </p>
        <p className="opacity-90">
          {urgent
            ? 'Booking, chat and calling stay switched off on your account until you accept. Everything else works as normal.'
            : `You have ${state.daysRemaining} day${state.daysRemaining === 1 ? '' : 's'} to review them. Nothing on your account changes until then.`}
        </p>
      </div>

      <Link
        to="/legal/consent"
        className="shrink-0 rounded-lg bg-current/10 px-3 py-2 font-semibold underline underline-offset-2 hover:bg-current/20"
      >
        Review and accept
      </Link>
    </div>
  )
}

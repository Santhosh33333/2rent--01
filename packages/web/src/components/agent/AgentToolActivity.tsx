import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, XCircle } from 'lucide-react'
import type { AgentToolActivity } from '../../lib/agentApi'

/**
 * AgentToolActivityList
 *
 * Shows what the assistant actually did, not just what it said. Every tool call
 * is listed with its verified status, so "I cancelled your request" is always
 * traceable to a `cancel_request` call rather than being an unsupported claim.
 */

const STATUS_STYLE: Record<
  AgentToolActivity['status'],
  { icon: typeof CheckCircle2; className: string; label: string }
> = {
  success: { icon: CheckCircle2, className: 'text-emerald-600 dark:text-emerald-400', label: 'Done' },
  confirmation_required: {
    icon: ShieldAlert,
    className: 'text-amber-600 dark:text-amber-400',
    label: 'Needs confirmation',
  },
  denied: { icon: XCircle, className: 'text-danger-500', label: 'Not allowed' },
  failed: { icon: AlertTriangle, className: 'text-danger-500', label: 'Failed' },
}

/** Human label for a tool id: get_my_subscription -> "Checked your subscription". */
const TOOL_LABELS: Record<string, string> = {
  get_my_profile: 'Checked your profile',
  get_my_subscription: 'Checked your subscription',
  get_my_requests: 'Checked your requests',
  get_active_request: 'Checked your active request',
  search_partners: 'Searched for partners',
  search_events: 'Searched events',
  search_communities: 'Searched communities',
  get_event: 'Looked up an event',
  get_notifications: 'Checked your notifications',
  get_payment_history: 'Checked your payments',
  get_wallet: 'Checked your wallet',
  get_support_information: 'Checked support options',
}

function labelFor(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName]
  return toolName.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

export function AgentToolActivityList({
  activity,
  compact = false,
}: {
  activity: AgentToolActivity[]
  compact?: boolean
}) {
  // The router returns the generic name "tool" for some outcomes; collapse those
  // so the user sees one row per real operation rather than a wall of noise.
  const named = useMemo(
    () => activity.filter((a) => a.toolName && a.toolName !== 'tool'),
    [activity],
  )
  if (!named.length) return null

  return (
    <ul className={compact ? 'space-y-1 mt-2' : 'space-y-1.5 mt-3'} aria-label="Actions the assistant performed">
      {named.map((item, i) => {
        const style = STATUS_STYLE[item.status]
        const Icon = style.icon
        return (
          <li
            key={`${item.toolName}-${i}`}
            className="flex items-start gap-2 rounded-xl bg-surface-100/70 px-2.5 py-2 dark:bg-surface-800/60"
          >
            <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${style.className}`} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-surface-700 dark:text-surface-200">
                {labelFor(item.toolName)}
                <span className="sr-only">: {style.label}</span>
              </p>
              {item.summary && (
                <p className="text-[11px] text-surface-500 dark:text-surface-400 break-words">{item.summary}</p>
              )}
            </div>
            {item.status === 'failed' && (
              <button
                type="button"
                className="text-[11px] font-semibold text-primary-600 hover:underline shrink-0 dark:text-primary-300"
                disabled
                title="Retry is offered on the reply itself"
              >
                Failed
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function AgentTypingIndicator() {
  return (
    <div className="flex items-center gap-2 text-surface-500 dark:text-surface-400 text-sm" role="status" aria-live="polite">
      <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
      Checking live data…
    </div>
  )
}
import { useState } from 'react'
import { AlertTriangle, ShieldCheck } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import type { AgentConfirmation } from '../../lib/agentApi'

/**
 * AgentConfirmationDialog
 *
 * Shown before any mutating or financial action runs. It states what will change,
 * who it affects and any amount, so the decision is informed rather than a blind
 * "allow?". The backend independently refuses to execute without a matching
 * single-use token, so dismissing this dialog is enough to stop the action —
 * this is the human-readable half of a two-part control.
 */

export interface ConfirmationDecision {
  decision: 'confirm' | 'cancel'
  confirmation: AgentConfirmation
}

function argLines(args: unknown): Array<{ label: string; value: string }> {
  if (!args || typeof args !== 'object') return []
  return Object.entries(args as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && typeof v !== 'object')
    .map(([k, v]) => ({
      label: k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()),
      value: String(v),
    }))
}

export function AgentConfirmationDialog({
  confirmation,
  onDecide,
  busy = false,
}: {
  confirmation: AgentConfirmation | null
  onDecide: (d: ConfirmationDecision) => void
  busy?: boolean
}) {
  const [acknowledged, setAcknowledged] = useState(false)
  const details = confirmation ? argLines(confirmation.args) : []

  if (!confirmation) return null

  const amountEntry = details.find((d) => /amount|price|fee|total|balance/i.test(d.label))

  return (
    <Modal
      open
      onClose={() => onDecide({ decision: 'cancel', confirmation })}
      title="Please confirm this action"
      description={confirmation.summary}
      size="sm"
      dismissible={!busy}
    >
      <div className="space-y-4">
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 px-3 py-2.5 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
          <p className="text-xs leading-relaxed">
            This changes real data on your account. Nabri cannot undo it automatically.
          </p>
        </div>

        {amountEntry && (
          <div className="rounded-xl border border-surface-200 px-3 py-2.5 dark:border-surface-700">
            <p className="text-[11px] uppercase tracking-wide text-surface-500 dark:text-surface-400">Amount</p>
            <p className="text-lg font-semibold text-surface-900 dark:text-white">{amountEntry.value}</p>
          </div>
        )}

        {details.length > 0 && (
          <dl className="space-y-1.5">
            {details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-3 text-sm">
                <dt className="text-surface-500 dark:text-surface-400">{d.label}</dt>
                <dd className="font-medium text-surface-900 dark:text-white text-right break-all">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}

        <label className="flex items-start gap-2.5 text-xs text-surface-600 dark:text-surface-300 cursor-pointer">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-surface-300 text-primary-600 focus:ring-primary-500"
          />
          <span>I understand this action will be performed on my account immediately.</span>
        </label>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" size="md" className="flex-1" onClick={() => onDecide({ decision: 'cancel', confirmation })} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            className="flex-1"
            disabled={!acknowledged || busy}
            onClick={() => onDecide({ decision: 'confirm', confirmation })}
          >
            <ShieldCheck className="w-4 h-4 mr-1.5" aria-hidden />
            {busy ? 'Working…' : 'Confirm'}
          </Button>
        </div>

        <p className="text-[11px] text-surface-400 dark:text-surface-500 text-center">
          This confirmation expires in a few minutes and can only be used once.
        </p>
      </div>
    </Modal>
  )
}
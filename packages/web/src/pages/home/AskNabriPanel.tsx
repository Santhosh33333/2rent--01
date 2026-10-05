import {
  BadgeCheck,
  CalendarCheck,
  ChevronRight,
  Footprints,
  LayoutDashboard,
  Wallet,
} from 'lucide-react'
import { openAssistant } from '../../lib/assistantStore'

const SUGGESTIONS = [
  { label: 'Am I subscribed right now?', prompt: 'Am I subscribed right now?', icon: BadgeCheck },
  { label: 'Find walking partners near me', prompt: 'Find walking partners near me', icon: Footprints },
  { label: 'What can you do for me?', prompt: 'What can you do for me?', icon: LayoutDashboard },
  { label: 'Show my recent payments', prompt: 'Show my recent payments', icon: Wallet },
  { label: 'Show my upcoming plans', prompt: 'Show my upcoming plans and events', icon: CalendarCheck },
]

/**
 * The assistant's quick actions, surfaced on the home screen rather than buried
 * in a separate page, so the feature is actually reachable. Tapping a prompt
 * opens the assistant drawer and asks the question for you.
 */
export function AskNabriPanel() {
  return (
    <section aria-label="Ask Nabri" className="prism-card prism-ring p-1">
      <div className="relative rounded-[calc(1.5rem-1px)] p-5">
        {/* One aurora wash per screen, running slowly behind the panel. */}
        <div className="prism-aurora animate-prism-drift opacity-70" aria-hidden />

        <div className="relative z-10 mb-4 flex items-center gap-3">
          <span className="prism-chip h-10 w-10 text-white shadow-lg shadow-violet-500/25">
            <LayoutDashboard className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold font-display tracking-tight text-surface-900 dark:text-white">
              Ask Nabri
            </h2>
            <p className="truncate text-xs text-surface-500 dark:text-surface-400">
              Answers come straight from your live account.
            </p>
          </div>
        </div>

        <ul className="relative z-10 space-y-1.5">
          {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => openAssistant(prompt)}
                className="prism-row px-3 py-2.5"
              >
                <span className="prism-chip h-8 w-8 shrink-0">
                  <Icon className="h-4 w-4 text-surface-700 transition-colors duration-300 dark:text-surface-200" aria-hidden />
                </span>
                <span className="flex-1 truncate text-sm font-medium text-surface-800 dark:text-surface-100">
                  {label}
                </span>
                <ChevronRight
                  className="prism-row-chevron h-4 w-4 shrink-0 text-surface-400 transition-all duration-200"
                  aria-hidden
                />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
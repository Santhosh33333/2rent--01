import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Bot } from 'lucide-react'
import { AgentPanel } from './AgentPanel'
import {
  closeAssistant,
  consumeAssistantPrompt,
  getAssistantState,
  openAssistant,
  subscribeAssistant,
} from '../../lib/assistantStore'

/**
 * AgentLauncher
 *
 * Floating assistant button, hidden on the assistant's own route and for admin
 * tiers, which use their own separate interface. The button sits above the tab
 * bar so it never covers it. Any screen can open it via openAssistant(prompt).
 */

const HIDDEN_ROUTES = ['/ai', '/agent']

export function AgentLauncher() {
  const [state, setState] = useState(getAssistantState())
  const { pathname } = useLocation()

  useEffect(() => subscribeAssistant(setState), [])

  if (HIDDEN_ROUTES.some((r) => pathname.startsWith(r))) return null

  return (
    <>
      <button
        type="button"
        onClick={() => openAssistant()}
        aria-label="Open Nabri Assistant"
        className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-primary-500 text-white shadow-lg shadow-primary-500/30 transition-transform active:scale-95 hover:scale-105"
      >
        <Bot className="w-6 h-6" aria-hidden />
        <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-white dark:border-slate-950" />
      </button>
      <AgentPanel
        open={state.open}
        onClose={() => closeAssistant()}
        pendingPrompt={state.prompt}
        onPromptConsumed={() => consumeAssistantPrompt()}
      />
    </>
  )
}
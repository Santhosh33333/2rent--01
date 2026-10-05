import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Bot,
  LocateFixed,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import {
  agentApi,
  clearAgentMessages,
  loadAgentMessages,
  saveAgentMessages,
  type AgentCapability,
  type AgentConfirmation,
  type AgentMessage,
} from '../../lib/agentApi'
import { getErrorMessage } from '../../lib/error'
import { AgentConfirmationDialog, type ConfirmationDecision } from './AgentConfirmationDialog'
import { AgentToolActivityList, AgentTypingIndicator } from './AgentToolActivity'

/**
 * AgentPanel
 *
 * The whole assistant surface: transcript, verified tool activity, suggestions,
 * confirmation flow, retry and clear. Mounted inside AgentLauncher so it can be
 * opened from the floating button or the Home entry without duplicating state.
 *
 * Location is opt-in per turn. Nothing is cached and no coordinate is sent until
 * the user taps the location control, so the assistant can answer from the city
 * a user typed instead of silently reading their position.
 */

const STARTER_PROMPTS = [
  'Am I subscribed right now?',
  'What can you do for me?',
  'Find walking partners near me',
  'Show my recent payments',
]

const LOCATION_ERROR_CODES = new Set(['LOCATION_REQUIRED', 'LOCATION_UNAVAILABLE'])

export interface AgentPanelProps {
  open: boolean
  onClose: () => void
  /**
   * "overlay" is the floating-button sheet; "inline" fills the /ai route. Both
   * share one implementation so the transcript, tool activity and confirmation
   * flow cannot drift between the two entry points.
   */
  variant?: 'overlay' | 'inline'
  /** A prompt handed to the panel, e.g. from a quick-action chip. Sent once. */
  pendingPrompt?: string | null
  onPromptConsumed?: () => void
}

export function AgentPanel({
  open,
  onClose,
  variant = 'overlay',
  pendingPrompt = null,
  onPromptConsumed,
}: AgentPanelProps) {
  const [messages, setMessages] = useState<AgentMessage[]>(() => loadAgentMessages())
  const [input, setInput] = useState('')
  const [asking, setAsking] = useState(false)
  const [pending, setPending] = useState<AgentConfirmation | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [capabilities, setCapabilities] = useState<AgentCapability[]>([])
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [transportError, setTransportError] = useState<string | null>(null)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Persist so a reload does not lose the transcript.
  useEffect(() => {
    saveAgentMessages(messages)
  }, [messages])

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
      agentApi
        .capabilities()
        .then(setCapabilities)
        .catch(() => setCapabilities([]))
    }
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, asking])

  // Escape closes, but never while a confirmation is mid-flight.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirming) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, confirming])

  const priorHistory = useMemo(
    () =>
      messages
        .filter((m) => !m.error)
        .slice(-8)
        .map((m) => ({ role: m.role, content: m.content })),
    [messages],
  )

  const requestLocation = useCallback(() => {
    if (!('geolocation' in navigator)) {
      setTransportError('This device cannot share a location.')
      return
    }
    setLocating(true)
    setTransportError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        setLocating(false)
      },
      () => {
        setTransportError('Location permission was declined. Ask using a city name instead.')
        setLocating(false)
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    )
  }, [])

  const send = useCallback(
    async (text: string, approved?: AgentConfirmation) => {
      const trimmed = text.trim()
      if ((!trimmed && !approved) || asking) return

      const userMsg: AgentMessage = {
        id: `u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'user',
        content: trimmed || 'Yes, confirm that.',
        createdAt: Date.now(),
      }
      setTransportError(null)

      if (!approved) {
        setMessages((m) => [...m, userMsg])
      }
      setInput('')
      setAsking(true)

      try {
        const turn = await agentApi.ask(approved ? '' : trimmed, {
          history: approved ? priorHistory : priorHistory,
          approved: approved
            ? { token: approved.token, toolName: approved.toolName, args: approved.args }
            : undefined,
          location: location ?? undefined,
        })

        const assistantMsg: AgentMessage = {
          id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          role: 'assistant',
          content: turn.message,
          toolActivity: turn.toolActivity,
          suggestions: turn.suggestions,
          error: turn.error,
          createdAt: Date.now(),
        }
        setMessages((m) => [...m, assistantMsg])
        setPending(turn.awaitingConfirmation?.[0] ?? null)
      } catch (err) {
        setTransportError(getErrorMessage(err, 'The assistant is unavailable right now.'))
      } finally {
        setAsking(false)
        setConfirming(false)
      }
    },
    [asking, priorHistory, location],
  )

  // A quick-action from the home screen hands us a prompt. Send it exactly once
  // when the panel is already open, and clear the handoff so it does not repeat.
  useEffect(() => {
    if (!open || !pendingPrompt) return
    onPromptConsumed?.()
    void send(pendingPrompt)
  }, [open, pendingPrompt, onPromptConsumed, send])

  const onDecide = useCallback(
    async ({ decision, confirmation }: ConfirmationDecision) => {
      if (decision === 'cancel') {
        setPending(null)
        return
      }
      setConfirming(true)
      setPending(null)
      await send('', confirmation)
    },
    [send],
  )

  const clearAll = useCallback(() => {
    clearAgentMessages()
    setMessages([])
    setPending(null)
    setTransportError(null)
    agentApi.clearHistory().catch(() => {
      // Local state is already cleared; a failed audit write must not block it.
    })
  }, [])

  const onRetry = useCallback(
    (msg: AgentMessage) => {
      const idx = messages.findIndex((m) => m.id === msg.id)
      const prior = idx > 0 ? messages[idx - 1] : undefined
      setMessages((m) => m.filter((x) => x.id !== msg.id))
      if (prior?.role === 'user') void send(prior.content)
    },
    [messages, send],
  )

  const wantsLocation = messages.some(
    (m) => m.error && LOCATION_ERROR_CODES.has(m.error.code) && m.error.code === 'LOCATION_REQUIRED',
  )

  if (!open) return null

  const inline = variant === 'inline'
  /**
   * The overlay was `fixed inset-0`, i.e. the assistant covered the whole
   * screen on every device. That is wrong for what this is: it is opened from a
   * 48px button in the corner to answer one question ("is my payment in?"), and
   * on a phone a full-bleed takeover for that loses the page underneath and the
   * tab bar entirely.
   *
   * So on small screens it is a bottom sheet - 85dvh tall, rounded top, a visible
   * grabber, and the page stays legible above it. On a desktop it docks to the
   * right-hand edge instead, because there is room for it and covering a whole
   * monitor to run a chat would be absurd.
   *
   * `pointer-events-none` on the wrapper is what lets the backdrop be clickable
   * to dismiss while the panel itself is not.
   */
  const shellClass = inline
    ? 'flex flex-col h-[calc(100dvh-11rem)] min-h-[32rem] rounded-3xl border border-surface-200 bg-surface-50/60 overflow-hidden dark:border-surface-700 dark:bg-slate-950/40'
    : [
        'fixed z-[60] flex flex-col',
        'inset-x-0 bottom-0 top-auto max-h-[85dvh] rounded-t-3xl',
        'shadow-[0_-8px_40px_rgba(0,0,0,0.28)]',
        'md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:rounded-none md:rounded-l-3xl',
        'md:w-[26rem] md:max-h-none md:shadow-[-8px_0_40px_rgba(0,0,0,0.22)]',
        'bg-surface-50/95 backdrop-blur-md dark:bg-slate-950/95',
      ].join(' ')

  const showClear = messages.length > 0
  const confirmedTools = capabilities.filter((c) => !c.confirmationRequired).length

  return (
    <>
    <div className={shellClass}>
      {/* Grabber: says "this is a sheet" and gives the sheet drag-to-dismiss a
          handle to aim at. md:hidden because the docked panel has edges. */}
      {!inline && (
        <div aria-hidden className="md:hidden shrink-0 pt-2 pb-1 flex justify-center">
          <span className="h-1 w-10 rounded-full bg-surface-300 dark:bg-surface-600" />
        </div>
      )}
      <header className="flex items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-500 flex items-center justify-center shrink-0">
          <Bot className="w-5 h-5 text-white" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-surface-900 dark:text-white leading-tight">Nabri Assistant</p>
          <p className="text-[11px] text-surface-500 dark:text-surface-400 leading-tight">
            {confirmedTools > 0
              ? `${confirmedTools} live capabilities for your account`
              : 'Answering from live account data'}
          </p>
        </div>
        {showClear && (
          <button
            type="button"
            onClick={clearAll}
            className="rounded-xl p-2 text-surface-500 hover:bg-surface-100 hover:text-danger-500 dark:hover:bg-surface-800"
            aria-label="Clear conversation"
            title="Clear conversation"
          >
            <Trash2 className="w-4 h-4" aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl p-2 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
          aria-label="Close assistant"
        >
          <X className="w-5 h-5" aria-hidden />
        </button>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-primary-500 flex items-center justify-center mb-3">
              <Sparkles className="w-6 h-6 text-white" aria-hidden />
            </div>
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Ask about your account</p>
            <p className="mt-1 text-xs text-surface-500 dark:text-surface-400 max-w-xs mx-auto">
              Every answer comes from your real Nabri data. Nothing is guessed, and changes always ask
              for your confirmation first.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => send(p)}
                  className="rounded-full bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary-600 px-3.5 py-2.5 text-sm text-white">
                {m.content}
              </div>
            </div>
          ) : (
            <div key={m.id} className="max-w-[92%]">
              <div className="glass-card p-4">
                <p className="text-sm whitespace-pre-wrap text-surface-800 dark:text-surface-100">{m.content}</p>
                {m.toolActivity && <AgentToolActivityList activity={m.toolActivity} />}
                {m.error && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl bg-danger-500/10 px-3 py-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-danger-500" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-danger-600 dark:text-danger-400">{m.error.message}</p>
                      {m.error.retryable && (
                        <button
                          type="button"
                          onClick={() => onRetry(m)}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-danger-600 hover:underline dark:text-danger-400"
                        >
                          <RefreshCw className="w-3 h-3" aria-hidden /> Try again
                        </button>
                      )}
                    </div>
                  </div>
                )}
                {!m.error && m.suggestions && m.suggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {m.suggestions.slice(0, 3).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => send(s)}
                        disabled={asking}
                        className="rounded-full bg-surface-100 px-2.5 py-1 text-[11px] font-medium text-surface-600 hover:bg-surface-200 disabled:opacity-50 dark:bg-surface-800 dark:text-surface-300 dark:hover:bg-surface-700"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ),
        )}

        {asking && <AgentTypingIndicator />}
      </div>

      {(transportError || (wantsLocation && !location)) && (
        <div className="px-4 pb-2">
          <div className="rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200 flex items-start gap-2">
            <LocateFixed className="w-4 h-4 mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p>{transportError ?? 'I need your location to find partners near you. You can also name a city instead.'}</p>
              {!location && (
                <button
                  type="button"
                  onClick={requestLocation}
                  disabled={locating}
                  className="mt-1 font-semibold underline disabled:opacity-60"
                >
                  {locating ? 'Locating…' : 'Share my location'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void send(input)
        }}
        className="border-t border-surface-200 px-4 py-3 dark:border-surface-700"
      >
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={requestLocation}
            disabled={locating || asking}
            className={`shrink-0 rounded-xl p-2.5 transition-colors ${
              location
                ? 'bg-primary-600 text-white'
                : 'bg-surface-100 text-surface-500 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400'
            } disabled:opacity-50`}
            aria-label={location ? 'Location shared for this conversation' : 'Share my location'}
            aria-pressed={Boolean(location)}
            title={location ? 'Location on' : 'Use my location'}
          >
            <LocateFixed className="w-5 h-5" aria-hidden />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your account…"
            className="input flex-1"
            maxLength={500}
            disabled={asking}
            aria-label="Message the assistant"
          />
          <button
            type="submit"
            disabled={asking || input.trim().length < 2}
            className="btn-gradient btn-icon-lg shrink-0 disabled:opacity-50"
            aria-label="Send"
          >
            <Send className="w-5 h-5" aria-hidden />
          </button>
        </div>
        {location && (
          <p className="mt-1.5 text-[11px] text-surface-500 dark:text-surface-400 flex items-center gap-1">
            <LocateFixed className="w-3 h-3" aria-hidden />
            Using your location for nearby searches. Clear it with the button on the left.
          </p>
        )}
      </form>

      <AgentConfirmationDialog confirmation={pending} onDecide={onDecide} busy={confirming} />
      </div>

      {/*
        Tap-anywhere-to-dismiss, for the overlay variant only.

        A div, not a button, and `aria-hidden` on purpose. The header already
        carries a labelled close button and the panel has a visible X: a second
        focusable control with the same accessible name announces as "Close
        assistant, button" twice and gives a screen-reader user no way to tell
        which is which. This is a pointer convenience layered on top of that
        real control, so it is removed from the accessibility tree rather than
        competing with it.

        It sits at z-55 under the panel (z-60), so it only receives taps on the
        page still visible beside or above the sheet.
      */}
      {!inline && (
        <div
          aria-hidden="true"
          onClick={onClose}
          className="fixed inset-0 z-[55] cursor-default bg-slate-950/40 backdrop-blur-[2px] md:bg-slate-950/25 md:backdrop-blur-none"
        />
      )}
    </>
  )
}
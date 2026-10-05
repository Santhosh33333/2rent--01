import { api } from './api'

/**
 * Agent API client.
 *
 * Mirrors the backend contract in packages/backend/src/agent. The shapes here
 * are the only place the UI and the agent agree on, so a backend change surfaces
 * as a type error rather than a runtime blank screen.
 *
 * Location is sent only when the user has actually granted it for this turn.
 * Nothing is cached: the backend scopes a location to one request and never
 * stores it.
 */

export type AgentToolStatus = 'success' | 'denied' | 'failed' | 'confirmation_required'

export interface AgentToolActivity {
  toolName: string
  status: AgentToolStatus
  summary: string
  data?: unknown
}

export interface AgentConfirmation {
  token: string
  toolName: string
  summary: string
  args: unknown
  expiresAt: string
}

export interface AgentTurn {
  message: string
  toolActivity: AgentToolActivity[]
  awaitingConfirmation: AgentConfirmation[]
  suggestions: string[]
  error?: { code: string; message: string; retryable: boolean }
}

export interface AgentCapability {
  name: string
  description: string
  category: string
  confirmationRequired: boolean
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolActivity?: AgentToolActivity[]
  suggestions?: string[]
  error?: { code: string; message: string; retryable: boolean }
  createdAt: number
}

export interface AskOptions {
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  /** Set only after the user taps Confirm on a pending confirmation. */
  approved?: { token: string; toolName: string; args: unknown }
  location?: { latitude: number; longitude: number }
}

export const agentApi = {
  async ask(message: string, opts: AskOptions): Promise<AgentTurn> {
    const body: Record<string, unknown> = {
      message,
      history: opts.history.slice(-8),
    }
    // The backend does not return a session id: it derives the audit session
    // server-side per turn, so there is nothing to correlate client-side.
    if (opts.approved) {
      body.approvedToken = opts.approved.token
      body.approvedTool = opts.approved.toolName
      body.approvedArgs = opts.approved.args
    }
    if (opts.location) {
      // Explicit flag: the backend ignores coordinates unless the client says
      // permission was actually granted.
      body.locationGranted = true
      body.latitude = opts.location.latitude
      body.longitude = opts.location.longitude
    }
    const res = await api.post('/agent/ask', body)
    return res.data?.data as AgentTurn
  },

  async capabilities(): Promise<AgentCapability[]> {
    const res = await api.get('/agent/capabilities')
    return (res.data?.data?.tools ?? []) as AgentCapability[]
  },

  async clearHistory(): Promise<void> {
    await api.post('/agent/clear-history')
  },
}

/** Local conversation store. Cleared by the user; never uploaded. */
const STORAGE_KEY = 'nabri-agent-conversation-v1'

export function loadAgentMessages(): AgentMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as AgentMessage[]) : []
  } catch {
    return []
  }
}

export function saveAgentMessages(messages: AgentMessage[]): void {
  try {
    // Bounded so the store cannot grow without limit.
    localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)))
  } catch {
    // Storage full or blocked: the conversation still works for this session.
  }
}

export function clearAgentMessages(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
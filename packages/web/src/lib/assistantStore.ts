// Minimal external store that lets any screen open the AI assistant drawer and
// pre-seed it with a prompt, without threading props through the layout.
export interface AssistantState {
  open: boolean
  prompt: string | null
}

let state: AssistantState = { open: false, prompt: null }
const listeners = new Set<(s: AssistantState) => void>()

function emit() {
  for (const l of listeners) l(state)
}

export function getAssistantState(): AssistantState {
  return state
}

export function subscribeAssistant(fn: (s: AssistantState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Open the assistant. Passing a prompt seeds the first question. */
export function openAssistant(prompt?: string) {
  state = { open: true, prompt: prompt && prompt.trim() ? prompt.trim() : null }
  emit()
}

export function closeAssistant() {
  state = { ...state, open: false }
  emit()
}

/** The caller takes the seeded prompt; returns it and clears it. */
export function consumeAssistantPrompt(): string | null {
  const prompt = state.prompt
  if (prompt) state = { ...state, prompt: null }
  return prompt
}
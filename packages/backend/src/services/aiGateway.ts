/**
 * AI Gateway — single choke point for every current and future AI feature.
 *
 * Rules:
 * - AI never bypasses authN/Z, KYC, privacy, admin perms, payment
 *   verification, or booking state rules. Every AI endpoint below sits
 *   behind the same guards as the feature it touches.
 * - Cost control: in-memory per-user token bucket + response cache for
 *   repeated safe prompts. (Single-instance limitation is documented;
 *   move to Redis when horizontally scaled.)
 * - Providers: "none" (default — LLM features honestly report
 *   AI_NOT_CONFIGURED with the required env vars) or an OpenAI-compatible
 *   HTTP endpoint (AI_API_BASE + AI_API_KEY + AI_MODEL).
 */
import { env } from "../config/env";

export type AiProvider = "none" | "openai-compatible" | "nim" | "gemini";

const PROVIDER_BASE: Record<string, string> = {
  nim: "https://integrate.api.nvidia.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
  "openai-compatible": "",
};

const PROVIDER_MODEL: Record<string, string> = {
  nim: "meta/muse-glimmer-30b",
  gemini: "gemini-3.8-flash",
  "openai-compatible": "gpt-4o-mini",
};

function configuredProvider(): AiProvider {
  if (env.AI_PROVIDER === "nim" || env.AI_PROVIDER === "gemini") return env.AI_PROVIDER;
  if (env.AI_API_KEY && env.AI_API_BASE) return "openai-compatible";
  return "none";
}

export function aiProvider(): AiProvider {
  const p = configuredProvider();
  // nim/gemini still require a key; without one we report "none" so the app
  // stays honest (AI_NOT_CONFIGURED) instead of pretending to be live.
  if (p !== "none" && !env.AI_API_KEY) return "none";
  return p;
}

export function aiBaseUrl(): string {
  const p = aiProvider();
  if (p === "none") return "";
  return env.AI_API_BASE || PROVIDER_BASE[p] || "";
}

export function aiModelName(): string {
  const p = aiProvider();
  if (p === "none") return "";
  return env.AI_MODEL || PROVIDER_MODEL[p] || "gpt-4o-mini";
}

export function aiConfigInfo(): { provider: AiProvider; requiredEnv: string[]; baseUrl?: string; model?: string } {
  const provider = aiProvider();
  if (provider === "none") {
    return { provider, requiredEnv: ["AI_API_KEY", "AI_PROVIDER"] };
  }
  return {
    provider,
    requiredEnv: [],
    baseUrl: aiBaseUrl(),
    model: aiModelName(),
  };
}

// --- cost control: per-user token bucket (per process) ----------------------
const BUCKET_CAPACITY = Number(env.AI_USER_QUOTA_PER_HOUR || 60);
const buckets = new Map<string, { tokens: number; resetAt: number }>();

export function checkAiQuota(userId: string): { allowed: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entry = buckets.get(userId);
  if (!entry || entry.resetAt <= now) {
    buckets.set(userId, { tokens: BUCKET_CAPACITY - 1, resetAt: now + 3600000 });
    return { allowed: true };
  }
  if (entry.tokens <= 0) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.tokens -= 1;
  return { allowed: true };
}

// --- response cache for repeated safe prompts --------------------------------
const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE = 200;
const cache = new Map<string, { at: number; value: unknown }>();

export function aiCacheGet(key: string): unknown | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return hit.value;
}

export function aiCacheSet(key: string, value: unknown): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { at: Date.now(), value });
}

// --- LLM call (only when a provider is configured) ---------------------------
export interface AiCompletion {
  text: string;
  model: string;
  cached: boolean;
}

export interface AiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** OpenAI-compatible tool plumbing. */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/**
 * A chat turn that may come back asking for tools. Kept separate from
 * aiComplete, which is a single-shot prompt/response helper, so existing
 * callers are unaffected by the agent's tool loop.
 */
export interface AiChatCompletion {
  message: AiChatMessage;
  model: string;
  finishReason: string | null;
}

function notConfigured(): Error {
  const info = aiConfigInfo();
  const err: any = new Error(
    `AI features are not configured. Required env: ${info.requiredEnv.join(", ")}. Set AI_PROVIDER=gemini|nim|openai-compatible plus AI_API_KEY (free tiers).`
  );
  err.code = "AI_NOT_CONFIGURED";
  return err;
}

/**
 * One HTTP call to the provider, with the error handling both entry points share.
 *
 * aiChat had proper 429 handling and aiComplete did not, which meant the same
 * rate limit surfaced as "AI_RATE_LIMITED, retry in Ns" from one path and as a
 * bare "AI provider responded 429" from the other - the exact wording a user sees
 * when the assistant gives up mid-conversation. One helper means there is no
 * second place to forget.
 */
async function postCompletion(
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<any> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${aiBaseUrl()}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      // Never surface a provider response body to the caller: it can echo
      // prompt content. Log the status server-side so failures are diagnosable.
      const err: any = new Error(`AI provider responded ${res.status}.`);
      if (res.status === 429) {
        // Rate limiting is transient and self-clearing, so it must not be
        // reported to the user as a broken assistant. Providers advertise the
        // wait in a header and/or in the message; prefer the header.
        err.code = "AI_RATE_LIMITED";
        const retryAfterSec = Number(res.headers.get("retry-after"));
        err.retryAfterSec = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec : 10;
      } else {
        err.code = "AI_PROVIDER_ERROR";
      }
      err.status = res.status;
      console.warn(`[aiGateway] ${aiProvider()} ${aiModelName()} responded ${res.status}`);
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function aiChat(
  userId: string,
  messages: AiChatMessage[],
  opts: { tools?: unknown[]; maxTokens?: number; temperature?: number; toolChoice?: unknown } = {}
): Promise<AiChatCompletion> {
  if (aiProvider() === "none") throw notConfigured();

  const quota = checkAiQuota(userId);
  if (!quota.allowed) {
    const err: any = new Error("AI quota exceeded. Try again later.");
    err.code = "AI_QUOTA_EXCEEDED";
    err.retryAfterSec = quota.retryAfterSec;
    throw err;
  }

  const payload: Record<string, unknown> = {
    model: aiModelName(),
    temperature: opts.temperature ?? 0.2,
    max_tokens: Math.min(1024, Math.max(64, opts.maxTokens ?? 700)),
    messages,
  };
  if (opts.tools?.length) payload.tools = opts.tools;
  if (opts.toolChoice) payload.tool_choice = opts.toolChoice;

  const data = await postCompletion(payload, 45000);
  const choice = data?.choices?.[0];
  const message: AiChatMessage = choice?.message ?? { role: "assistant", content: "" };
  if (message.content === undefined) message.content = null;
  return {
    message,
    model: data?.model ?? aiModelName(),
    finishReason: choice?.finish_reason ?? null,
  };
}

export async function aiComplete(
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; cacheKey?: string } = {}
): Promise<AiCompletion> {
  if (aiProvider() === "none") throw notConfigured();

  const quota = checkAiQuota(userId);
  if (!quota.allowed) {
    const err: any = new Error("AI quota exceeded. Try again later.");
    err.code = "AI_QUOTA_EXCEEDED";
    err.retryAfterSec = quota.retryAfterSec;
    throw err;
  }
  const cacheKey = opts.cacheKey ? `ai:${opts.cacheKey}` : undefined;
  if (cacheKey) {
    const hit = aiCacheGet(cacheKey);
    if (hit && typeof hit === "object" && hit !== null && "text" in hit) {
      return { ...(hit as AiCompletion), cached: true };
    }
  }
  const maxTokens = Math.min(1024, Math.max(64, opts.maxTokens ?? 512));
  const model = aiModelName();

  // Same helper as aiChat, so a rate limit here reports AI_RATE_LIMITED with a
  // retry hint rather than an opaque "AI provider responded 429".
  const data = await postCompletion(
    {
      model,
      temperature: opts.temperature ?? 0.3,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    30000,
  );
  const text = data?.choices?.[0]?.message?.content?.trim() || "";
  if (!text) throw new Error("AI provider returned an empty response.");
  const out: AiCompletion = { text, model, cached: false };
  if (cacheKey) aiCacheSet(cacheKey, out);
  return out;
}

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

export type AiProvider = "none" | "openai-compatible";

export function aiProvider(): AiProvider {
  if (env.AI_API_KEY && env.AI_API_BASE) return "openai-compatible";
  return "none";
}

export function aiConfigInfo(): { provider: AiProvider; requiredEnv: string[] } {
  const provider = aiProvider();
  return provider === "none"
    ? { provider, requiredEnv: ["AI_API_BASE", "AI_API_KEY", "AI_MODEL"] }
    : { provider, requiredEnv: [] };
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

export async function aiComplete(
  userId: string,
  systemPrompt: string,
  userPrompt: string,
  opts: { maxTokens?: number; temperature?: number; cacheKey?: string } = {}
): Promise<AiCompletion> {
  const provider = aiProvider();
  if (provider === "none") {
    const info = aiConfigInfo();
    const err: any = new Error(`AI features are not configured. Required env: ${info.requiredEnv.join(", ")}.`);
    err.code = "AI_NOT_CONFIGURED";
    throw err;
  }
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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    const res = await fetch(`${env.AI_API_BASE}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL || "gpt-4o-mini",
        temperature: opts.temperature ?? 0.3,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`AI provider responded ${res.status}.`);
    const data: any = await res.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    if (!text) throw new Error("AI provider returned an empty response.");
    const out: AiCompletion = { text, model: env.AI_MODEL || "gpt-4o-mini", cached: false };
    if (cacheKey) aiCacheSet(cacheKey, out);
    return out;
  } finally {
    clearTimeout(timer);
  }
}

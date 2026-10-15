---
name: nabri-ai-cost
description: Provider-independent AI integration for Nabri — the aiGateway, legitimate free-tier and keyless providers, caching, quotas, timeouts, secret handling and cost monitoring; plus keeping beta infrastructure at ₹0. Load this for any AI feature, provider change, or spend-affecting service decision.
---

# Nabri AI & Cost

## When to use this skill

Anything that adds or changes an AI call, an external paid API, a provider
credential, a recommendation/matching engine, or a service that could accrue
charges. Also load it when an AI feature needs to degrade honestly.

## The one rule about keys

AI credentials exist **only** on the backend. Nothing in `packages/web` may
hold an AI key. Frontend env vars are `VITE_*` and are public to anyone who
opens devtools. Never introduce a key there, and never "temporarily" hardcode
one in a component.

## The AI gateway

All model traffic goes through `packages/backend/src/services/aiGateway.ts` —
a single choke point. Do not call a provider from a controller directly.

- **Provider selection** is by name from `AI_PROVIDER`, resolved by
  `aiProvider()` / `aiConfigInfo()`. Supported:
  `none | openai-compatible | nim | gemini | groq | pollinations`.
  Configurable with `AI_API_BASE`, `AI_API_KEY`, `AI_MODEL`.
- **Keyless fallback** — `AI_ALLOW_PUBLIC_FALLBACK` opts into a keyless public
  endpoint. That is a rate-limited courtesy tier, not a plan: treat it as
  best-effort and never as production capacity.
- **Unconfigured** → the gateway returns `AI_NOT_CONFIGURED` with the env names
  needed. Callers must surface that honestly ("AI is not configured on this
  server") rather than rendering a plausible-looking answer.
- Capabilities surface at `GET /api/ai/status`; features are `GET /api/ai/ask`,
  `/matches`, `/translate`, `/draft`. The agentic layer is separate:
  `src/agent/*` behind `/api/agent/ask|confirm|capabilities`.

## Working with providers honestly

- **Respect quotas.** `AI_USER_QUOTA_PER_HOUR` is enforced per user. Do not
  add a second, looser quota that undercuts it, and never rotate accounts or
  keys to dodge a limit.
- **Cache eligible responses.** Deterministic or slowly-changing results
  (translations, static explanations, match scores for a stable input) should
  be cached with a TTL before spending a request. Ask whether the response
  would be identical tomorrow; if yes, cache it.
- **Timeouts are mandatory.** Every outbound AI call needs a bounded timeout
  and a fallback path. A hung provider must not hang a user's request.
- **Circuit-break on failure.** Repeated provider errors should short-circuit
  so you are not retrying a dead endpoint for every user.
- **Rate-limit** new AI entry points with `express-rate-limit`.

## Free / low-cost options that fit this stack

Legitimate free tiers that the gateway already models — evaluate before writing
anything new:

| Provider | Notes |
|---|---|
| `groq` | Generous free inference tier; fast, good for chat-sized calls |
| `nim` | NVIDIA NIM hosted free endpoints |
| `gemini` | Has a usable free tier with limits |
| `pollinations` | Keyless text/image generation; rate-limited, no SLA |
| `openai-compatible` | Any compatible base URL, including self-hosted |

Open-source local models (Ollama, llama.cpp) are acceptable **only** where a
machine actually exists to run them — the beta has no GPU host, so assume
remote.

## The ₹0 cost strategy

Target near-zero mandatory monthly spend during beta without compromising
security or pretending a service is free forever.

- **Reuse what is deployed.** Backend on Render free tier, web on Vercel free
  tier, one Postgres (Prisma) database, one Redis. Do not add a second
  database, a queue, or a CDN subscription without a stated need.
- **One primary database + auth provider.** No duplicates.
- **Free AI quotas only when available** — and cache aggressively so the quota
  covers real usage.
- **Never assume free.** SMS, email, maps, AI, video calling, media storage
  and TURN traffic all have limits. Document the quota, the inactivity policy
  and the likely future cost for anything you add.
- **No surprise billing.** Do not enable a paid service or automatic billing
  anywhere without explicit user approval. This is a hard rule.
- **Known free-tier limits to expect** — Render free tier sleeps after idle
  (first request after idle is slow), Vercel free tier has bandwidth/hours
  caps, and the free AI tiers have per-day/per-hour request caps.

## Moderation and safety

Content-generating or user-facing AI should be screened with the existing spam
guard (`SPAM_BLOCK_WORDS`) and must not produce fabricated facts presented as
data — no invented events, profiles or numbers.

## Verify

- `npx tsc --noEmit` in `packages/backend`.
- `npm test --workspace=packages/backend`.
- When adding a provider path, prove the *unconfigured* branch too: the feature
  must fail with a clear message, not a blank screen.
- Report which env vars a feature requires by name. Never print their values.

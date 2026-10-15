# AGENTS.md — Nabri

Working rules for AI agents (and humans) operating on this repository.
Project-specific instructions live here; they do not override the model's
general safety rules — when they conflict, safety wins.

---

## 1. Product

**Nabri — "Your Partner for Every Side of Life."** A social, dating, events and
local-services platform. Not a generic demo: production holds real users.

| Surface | Where |
|---|---|
| Web app (public) | `https://yuvers.in` (also `https://2rent-01.vercel.app`) |
| Backend API | `https://rentbuddy-api-s7rz.onrender.com` |
| Android app | Capacitor WebView, Play closed testing |
| Website (marketing) | `https://web-nabri.vercel.app` |

Domain: dating, friendship, nearby discovery, events, communities, feed, music
rooms, movies, sports, travel, walking buddy / carry buddy local services,
wallet + subscriptions, AI assistant, admin console.

**Codebase identity:** the repo still carries its original names (`rentbuddy`,
`packages/web` package name `rentbuddy-web`). Do not mass-rename; the
Play listing, env vars and URLs already reference both.

---

## 2. Architecture

```
D:\rent-02\2rent--01\            ← git repository root (this is NOT D:\rent-02)
├── packages/
│   ├── backend/     Express 4 + TypeScript + Prisma 5 + socket.io (Vitest tests)
│   ├── web/         React 18 + Vite 6 + React Router 6 + Tailwind + Capacitor 8
│   └── mobile/      Expo/React Native shell (no tests)
├── .opencode/skills/            ← project skills (see §5)
└── docs/APP_GROWTH_PLAN.md      ← zero-budget growth plan
```

**Route mounting** — `packages/backend/src/app.ts` (lines ~327–397). A router
that is not mounted there silently 404s.

**Frontend routes** — `packages/web/src/App.tsx`. `React.lazy` per page.
Signed-in screens render inside `components/Layout.tsx`, which owns the header,
the sidebar/More sheet and the bottom tab bar.

**Backend layering** — `routes/<domain>Routes.ts` → `controllers/<domain>Controller.ts`
→ `services/<domain>Service.ts`. Keep it that way; put business rules and Prisma
access in the service.

**Navigation is declared, not inferred** — `packages/web/src/navigation/tabs.ts`.
Add destinations there, never hardcode dock links in a layout.

---

## 3. Scripts

Run from the repo root unless noted.

```sh
# install / dev
npm install
npm run dev:backend      # Express on :3000
npm run dev:web          # Vite dev server

# verification
npm run typecheck                        # all workspaces
npm run lint                              # all workspaces
npm test --workspace=packages/backend     # Vitest, 115 test files
cd packages/web && npm run build          # tsc -b && vite build

# database
npm run db:generate --workspace=packages/backend
npm run db:migrate    --workspace=packages/backend
npm run db:seed       --workspace=packages/backend

# android (from packages/web; needs Java 21 + Android SDK)
npm run build
npx cap sync android
cd android && .\gradlew.bat bundleRelease assembleRelease
```

**Test coverage reality:** the backend has ~115 Vitest files. `packages/web`
and `packages/mobile` have **zero** test files — web changes are verified by
typecheck, build and manual inspection. Say so; do not imply coverage that
does not exist.

---

## 4. Folder map (the modules you will touch most)

**Web**
- `src/App.tsx` — all routes
- `src/components/Layout.tsx` — signed-in shell, tab bar, header, More sheet
- `src/components/navigation/` — `AppTabBar`, `MoreSheet`
- `src/navigation/tabs.ts` — tab + menu declarations
- `src/pages/` — 36 feature folders (`home`, `feed`, `dating`, `events`,
  `communities`, `movies`, `music`, `messages`, `search`, `notifications`,
  `settings`, `wallet`, `admin`, `ai`, `invite`, `landing`, …)
- `src/lib/api.ts` — axios client + per-domain API objects
- `src/lib/auth.tsx` — session, roles, `isSignedIn()`
- `src/hooks/` — `useFeatureFlag`, `useSocket`, `useScreenLock`, `useAsync`, …
- `src/styles/globals.css` — accent/`--c-*` variables, safe-area vars, glass utilities

**Backend**
- `src/routes/` (46), `src/controllers/` (66), `src/services/` (83)
- `src/middleware/`, `src/rbac/`, `src/services/ai/`, `src/agent/`
- `src/config/env.ts` — zod-validated env (single source of truth for names)
- `prisma/schema.prisma` — ~130 models; `prisma/migrations/`
- `src/__tests__/` — Vitest suites

---

## 5. Code conventions

- **TypeScript strict.** No `any` in new code unless mirroring an existing
  pattern; prefer explicit types. `npm run typecheck` must pass.
- **Tailwind only** — no inline style objects for colour/spacing. Accent colour
  comes from `--c-*` / `primary-*`; never hardcode a hex brand colour.
- **Reuse the primitives:** `GlassCard`, `AnimatedPage`, `Reveal`, `Tilt`,
  `PageHeader`, `EmptyState`, `ScreenState`, `Modal`, `BottomSheet`,
  `components/ui/*`. Do not re-implement a card or modal.
- **Dark mode** is class-based (`html.dark`). Every new surface needs a
  `dark:` counterpart.
- **Safe areas** — use `--safe-bottom` / `--safe-top` for anything fixed.
- **Errors** — backend returns `{ error: { code, message } }` with a stable
  `code`; web renders `getErrorMessage(err)`. Never surface a raw axios message.
- **Responses** — success uses `{ data: … }`; lists use
  `{ data: { items, total, page } }`.
- **Comments explain *why***, in the style already used — the codebase writes
  considered rationale comments. Match that voice; skip narration.
- **Files are lazily imported** in `App.tsx`. Keep new heavy pages lazy.

### Framework limitations to respect

- **Capacitor WebView, not a browser.** `window.open` is dropped — use
  `openExternalUrl()` (`lib/externalLink.ts`). `navigator.share` may be
  unavailable — use `lib/share.ts`. Setting `location.href` inside a long
  injected script fails; navigate in one call, read in the next.
- **PowerShell is the shell** — no `&&`, no `??` in chained commands. Use `;`.
- `adb devices` is often empty; a "mobile check" that was not run on a device
  must be reported as not run.

---

## 6. Security and environment

- **Never print secrets** — no API keys, tokens, passwords, service-account
  JSON, OTPs, or personal user data in code, logs, commits, prompts or
  reports. Refer to env vars **by name only**.
- Env vars are validated in `packages/backend/src/config/env.ts` (zod). Add
  new ones there with defaults. Use `isPlaceholder()` rather than truthiness —
  it treats `"" | placeholder | changeme | dev | test` as unset.
- **Frontend env is public.** Anything prefixed `VITE_` ships to the browser.
  No AI key, DB key, service account or privileged credential may appear in
  `packages/web`.
- **Every private API needs server-side authorisation.** Hiding a button is
  not authorisation. Verify ownership or role in the controller.
- **Admin is separate from user signup.** Use `isAdminTierRole` /
  `isSuperAdminRole` (`packages/web/src/lib/roles.ts`, backend `src/rbac/`).
- **Unconfigured providers fail honestly** — `AI_NOT_CONFIGURED`,
  `EMAIL_NOT_CONFIGURED`, `SMS_NOT_CONFIGURED`, `MOVIES_NOT_CONFIGURED`,
  `PAYMENT_NOT_CONFIGURED`, `*_NOT_CONFIGURED`. Never fake a success path for
  a provider that is not set up.
- **No surprise billing.** Do not enable a paid service or automatic billing
  without explicit user approval.
- Migrations: never edit an applied migration; write a new one. Production
  data changes need a stated recovery plan.

---

## 7. Skills

Five project skills live in `.opencode/skills/` (IDs come from the directory
name). Load the one matching the task **before** starting it:

| Skill | Use when |
|---|---|
| `nabri-ui-ux` | Any screen, layout, navigation, theming or visual change |
| `nabri-fullstack` | Any feature spanning UI + API, or backend work |
| `nabri-database-security` | Schema, migrations, permissions, uploads, privacy |
| `nabri-ai-cost` | AI integration, providers, or anything affecting spend |
| `nabri-testing-release` | Before declaring work complete; before any release |

**Rule:** UI/UX work → `nabri-ui-ux`. Features → `nabri-fullstack`. Sensitive
data or permissions → `nabri-database-security`. AI or cost decisions →
`nabri-ai-cost`. Verification/release → `nabri-testing-release`. Tasks that
span categories load more than one.

---

## 8. Hard rules

1. **Do not fabricate.** Never invent test results, deployed changes, AI
   responses, user profiles, events, counts, reviews or metrics. If you did not
   run it, say "not run". If it does not exist, say so.
2. **No mock data in production.** No fake profiles, fabricated events or
   simulated AI output. An honest empty state always beats a convincing fake.
3. **Inspect before you change.** Read the surrounding code, dependencies and
   existing working behaviour first. Preserve working features — this is a
   live product, not a scaffold to replace. Never replace the app with a new
   demo project.
4. **Do not overwrite user data** or make destructive database changes
   without a backup and a recovery plan.
5. **Do not enable paid services** or change billing-related configuration
   without explicit approval.
6. **Small, reviewable stages.** Report after each stage: files changed,
   functionality implemented, checks actually run, unresolved issues, next
   priority. Pushing to `main` auto-deploys Render + Vercel — treat a push as a
   release.

---

## 9. Priority order

1. Stable login and navigation.
2. Beautiful, fast home screen.
3. Real discovery, feed, messaging and notifications.
4. Events, communities and safety.
5. AI and advanced features — behind feature flags.

Feature flags: table `FeatureFlag`, API `GET /api/content/feature-flags`,
frontend `src/hooks/useFeatureFlag.ts` (keys in `KNOWN_FLAGS`). Gate anything
new and uncertain; ship it gradually rather than all at once.

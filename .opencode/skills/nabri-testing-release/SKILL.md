---
name: nabri-testing-release
description: Unit, integration, regression and build validation for Nabri, plus release preparation — running the real suites, verifying a change honestly, and preparing Android/web builds. Load this before declaring any change complete, and before any release or deploy.
---

# Nabri Testing & Release

## When to use this skill

Before claiming a change is finished, before merging/pushing, and before any
build that ships to users. Also when adding tests or diagnosing a regression.

## The honesty rule

**Never claim a test passed unless you executed it and saw it pass.** If you
did not run it, write "not run". If a suite exists but does not cover the
change, say that. A fabricated green check is worse than an honest gap — it
makes the next change unsafe.

Same rule for deploys, AI responses, user profiles, events and data: describe
only what actually exists and what you actually observed.

## Commands

Run from the repo root `D:\rent-02\2rent--01` unless noted.

```sh
# Type checking (all workspaces)
npm run typecheck

# Backend tests — Vitest, 115 test files (112 in src/__tests__, 3 in tests/)
npm test --workspace=packages/backend

# Targeted suites
cd packages/backend; npx tsx tests/admin-rbac.test.ts
cd packages/backend; npx tsx tests/admin-security.test.ts

# Web lint + build (typecheck is part of build)
npm run build:web
# or from packages/web:
npm run lint
npm run typecheck
npm run build
```

**Known gap:** `packages/web` and `packages/mobile` have **zero test files**.
Web changes are verified by `typecheck` + `build` + manual inspection only.
State that honestly rather than implying frontend coverage exists.

Environment: Java 21, Android SDK at
`C:\Users\acer\AppData\Local\Android\Sdk`, Node ≥ 20. Windows PowerShell lacks
`&&` — chain with `;`. Git writes to stderr, so a non-zero exit code can still
mean success.

## What to verify per change type

| Change | Must pass |
|---|---|
| Web-only UI | `npm run typecheck`, `npm run build` in `packages/web` |
| Backend logic | `npx tsc --noEmit` + full `npm test --workspace=packages/backend` |
| Schema/migration | typecheck + tests + confirm the migration applies cleanly |
| Permissions | also `tests/admin-rbac.test.ts`, `tests/admin-security.test.ts` |
| Anything shipped | the above **plus** a build of the affected artefact |

Run the **whole** backend suite after any change touching routes, middleware,
Prisma models or shared services. Passing only the tests you expect to be
affected misses regressions.

## Manual verification checklist

There is no web test suite, so these journeys are checked by hand. Do not mark
them verified without having actually done it:

- [ ] Every bottom-nav item opens its correct page (nav is declared in
      `src/navigation/tabs.ts`).
- [ ] Login persists after closing and reopening the app (storage must not be
      cleared on cold start).
- [ ] Search, recommendations and filters show real API data, not placeholders.
- [ ] Feed actions (like, comment, save, report) update and persist after
      reload.
- [ ] Messages, matches, notifications, events and communities work end to end.
- [ ] Empty states, offline, and a failing API request do not crash the page.
- [ ] Loading, empty, offline and error states exist on important screens.
- [ ] Home screen at mobile (360 px), tablet and desktop widths.
- [ ] Light and dark theme both readable; accents switch.

If a device is not attached (`adb devices` empty), say the mobile check was
**not** performed.

## Android release build

```sh
cd packages/web
npm run build
npx cap sync android
cd android
.\gradlew.bat bundleRelease assembleRelease
```

Outputs: `android/app/build/outputs/bundle/release/app-release.aab` and
`.../apk/release/app-release.apk`.

- Version lives in `packages/web/android/app/build.gradle`:
  `versionCode` + `versionName` (currently 26 / 1.0.25). Bump both together.
- Record the SHA-256 of the AAB when staging a release.
- Release notes for Play must be wrapped in `<en-GB>` tags on their own lines,
  ≤ 500 chars per language.

## Play Console release notes

- A new submission while another release is in review **cancels and restarts**
  that review. Check "Changes in review" in Publishing overview first.
- Store-listing edits can be staged with **Save for later** so they do not
  restart an in-flight review.
- New personal accounts need ≥ 12 testers opted in, continuously, for 14 days
  before production. Track the count — dropping below 12 resets the clock.

## Reporting

End every release-prepared change with a short, factual summary:

- files changed
- functionality implemented
- checks **actually run** and their real results
- unresolved issues
- next priority

Never declare completion before verification. Never overwrite user data or
expose secrets.

# DEPLOY_APK.md — get the real APK + latest code live

Every artifact and where it lives today:

| Surface | Canonical location | Notes |
|---|---|---|
| Signed Android APK (app.rentbuddy.app, versionCode 16, versionName 1.0.15, ~16.5 MB) | `packages/web/android/app/build/outputs/apk/release/app-release.apk` | Produced by `npm run cap:build:release`; signing via gitignored `android/keystore.properties` + `rentbuddy-release.jks`. A signed AAB for Play Store is at `.../outputs/bundle/release/app-release.aab`. |
| Web build (`/feed`, download page, `NABRI_APK_URL` baked in) | `packages/web/dist` | Build: `npm run build:web`; deploy: Vercel project `2rent-01`. |
| API (feed endpoints, feature flags, gifts, realtime) | Render service `rentbuddy-api` | `render.yaml` `autoDeploy: true`; migrations run on start. |
| `NABRI_APK_URL` | Vercel env var on `2rent-01` | When set, the download buttons link out to it; otherwise a deploy with no local APK shows **NOT CONFIGURED**. |

The 24 MB binary and the keystore are **not** in git (`.gitignore`: `*.apk`, `*.jks`). That is why CI deploys default to NOT CONFIGURED — the fix is to give the deploy an *address* for the APK instead of the *file*.

---

## 1. Publish the APK (choose one path)

### Path A — GitHub Actions (no local Android SDK needed) — recommended

1. Add repository secrets (Settings → Secrets and variables → Actions) so CI can
   reproduce the **signed** release build:
   - `ANDROID_KEYSTORE_BASE64` — one-line `base64` of `rentbuddy-release.jks`
   - `KEYSTORE_STORE_PASSWORD`, `KEYSTORE_KEY_ALIAS`, `KEYSTORE_KEY_PASSWORD` —
     the same three values already in local `packages/web/android/keystore.properties`
   Without the secrets the workflow **fails before publishing** (Android refuses
   to install unsigned APKs). The `allow unsigned` dispatch option will force a
   publish anyway for a smoke-only artifact — it is not installable, so it is
   never meant as a real update.
2. Actions tab → **Build APK and publish a GitHub Release** → Run workflow →
   `version: 1.0.15` (keep matching `build.gradle` `versionName`; bump
   `versionCode` there for install-over-existing).
3. The run prints a stable asset URL:
   `https://github.com/Santhosh33333/2rent--01/releases/download/nabri-v<version>/nabri.apk`

### Path B — local machine (you have the keystore)

```powershell
# Builds the signed APK and publishes it. No gh install needed: the script
# falls back to a token from the git credential manager (or GH_TOKEN) and
# publishes via the GitHub REST API with just the `repo` scope.
node scripts/publish-apk.mjs --version 1.0.15 --build
# or point at an existing artifact:
#   node scripts/publish-apk.mjs --version 1.0.15 --apk .\nabri-app-release-1.0.15.apk
# preview without publishing:
#   node scripts/publish-apk.mjs --dry-run
```

If neither a token nor `gh` is available the script prints the exact commands
instead of guessing.

> **Gotcha — never bundle a stale APK inside the new APK.** A local
> `npm run build` copies any existing `dist/download/nabri.apk` into `dist`, and
> `npx cap sync android` then copies *all* of `dist` into the Android assets, so
> the new APK ends up carrying a copy of the previous 20+ MB APK (inflating it
> from ~16 MB to ~39 MB). Before `cap sync`, delete `packages/web/dist/download`:
>
> ```powershell
> Remove-Item packages/web/dist/download -Recurse -Force -ErrorAction SilentlyContinue
> npx cap sync android
> ```

---

## 2. Point Vercel at the APK

On the **2rent-01** project:

- Dashboard: Settings → Environment Variables → add `NABRI_APK_URL` = the asset URL above.
- Or CLI (project is already linked via `.vercel`):

```powershell
npx vercel env add NABRI_APK_URL production
```

---

## 3. Redeploy the web app

- Push to the branch Vercel builds (if git-integrated), **or**
- `npx vercel --prod` from the repo root (uses the existing linked project).

The build-time defines (`__APK_AVAILABLE__`, `__APK_URL__`) read
`NABRI_APK_URL` at build time, so the URL must be set **before** the redeploy.

---

## 4. Redeploy the API

- Push to `main` → Render auto-deploys (`autoDeploy: true`), running
  `prisma migrate deploy` on start (the feed migration
  `20261006_social_feed_global_posts` is applied on boot).
- Manual: Render dashboard → **rentbuddy-api** → Manual Deploy → Deploy latest commit.

---

## 5. Verify everything

```bash
# API up + public feature flags (must be 200 now, was 401 on the stale deploy)
curl -s https://rentbuddy-api-s7rz.onrender.com/api/content/feature-flags

# Feed endpoint exists (401 without a token is *expected*)
curl -s -o /dev/null -w "%{http_code}\n" https://rentbuddy-api-s7rz.onrender.com/api/posts

# APK reachable from wherever the release lives
curl -sIL https://github.com/Santhosh33333/2rent--01/releases/download/nabri-v1.0.15/nabri.apk
#   -> expect 302 then 200 with Content-Type: application/vnd.android.package-archive

# Web bundle actually changed (compare hash with what you built locally)
curl -s https://2rent-01.vercel.app/ | grep -o 'index-[A-Za-z0-9_-]*\.js'
```

Landing page + `/download` should now show the download button with the real
size instead of **Not configured**, and `/feed` on the web + the feed on the
APK talk to the freshly deployed API.

---

## 6. Play Store update (Android App Bundle)

Play Store rejects APKs for new apps/updates in favour of an **AAB**. Build it
with the same release keystore:

```powershell
# from packages/web, after `npm run build:web` and `npx cap sync android`
cd android
$env:TEMP="D:\tmp-gradle"; $env:TMP="D:\tmp-gradle"   # keep Gradle off a full C:
.\gradlew.bat bundleRelease
```

Output: `packages/web/android/app/build/outputs/bundle/release/app-release.aab`
(currently **1.0.15 / versionCode 16**).

Upload steps:

1. Bump `versionCode` (and usually `versionName`) in
   `packages/web/android/app/build.gradle` for **every** upload — Play rejects a
   bundle whose `versionCode` is not higher than the live one.
2. Play Console → your app → **Production → Create new release** → upload the
   `.aab` → add release notes → **Save → Review release → Start rollout**.
3. The AAB is signed with the existing `rentbuddy-release.jks`, which must match
   the **upload key** already registered with Play App Signing.

The signed APK from the same build is uploaded to the GitHub Release (above) for
direct/sideload installs; both come from one `bundleRelease assembleRelease` run.

---

The web download page previously shipped a hardcoded "11 MB" claim and pointed
at an APK the deployed build did not contain (the binary is gitignored). The
fix has three parts, all in this repo now:

1. `vite.config.ts` copies a *local* APK into `dist/download` when present, and
   otherwise reads `NABRI_APK_URL`; either way `__APK_AVAILABLE__`/`__APK_URL__`
   tell the UI the truth (real size, no dead links).
2. `scripts/publish-apk.mjs` + `.github/workflows/build-apk-and-release.yml`
   give the binary a permanent home address (a GitHub Release asset).
3. This runbook wires 1 + 2 into the two live deployments.
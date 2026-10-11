# DEPLOY.md — shipping Nabri

Nabri ships **only through Google Play**. There is no sideloaded APK and no
direct-download URL. Sideloaded builds bypass Play's integrity checks and cannot
auto-update, so handing out an APK was a support and security liability; the
`NABRI_APK_URL` build hook, the `scripts/publish-apk.mjs` helper and the
`Build APK and publish a GitHub Release` workflow have all been removed.

Every "get the app" surface on the web links to the canonical Play listing via
`packages/web/src/lib/appLinks.ts`:

```
export const PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=app.rentbuddy.app'
```

## Surfaces

| Surface | Canonical location | Notes |
|---|---|---|
| Web app (landing, /download, forms) | `packages/web/dist` | Build: `npm run build:web`. Deploy: the Vercel project that serves the public domain. |
| Android app | Google Play listing `app.rentbuddy.app` | Built from `packages/web` with Capacitor. |
| API | Render service `rentbuddy-api` | `render.yaml` `autoDeploy: true`; migrations run on start. |

## Android release (Google Play)

Play wants an **Android App Bundle (AAB)**, not an APK.

```powershell
cd packages/web
npm run build
npm run cap:build:aab     # npx cap sync android && cd android && ./gradlew bundleRelease
```

Output:

```
packages/web/android/app/build/outputs/bundle/release/app-release.aab
```

Signing uses the gitignored `packages/web/android/keystore.properties` plus
`rentbuddy-release.jks`. Neither is in git.

Before uploading, bump `versionCode` (and `versionName`) in
`packages/web/android/app/build.gradle`. Android refuses an update whose
`versionCode` is not higher than what is already published.

Then upload the AAB in Play Console → your app → **Production** (or a testing
track), add release notes, and roll out.

> The Android app bundles `packages/web/dist`; it does **not** load a remote URL
> (there is no `server.url` in `capacitor.config.ts`). So a web-only change fixes
> the site at `yuvers.in` but does **not** reach anyone on an installed build
> until a new AAB is built here and rolled out.

## Web deploy

The public site is the Vercel project `web` linked in this repo; the production
alias is <https://yuvers.in>. Build locally to check a change:

```bash
npm run build:web      # builds packages/web into packages/web/dist
```

Then deploy from the repo root:

```bash
npx vercel --prod      # builds remotely and re-points https://yuvers.in
```

A push alone did **not** trigger a Vercel build here, so run the command above
after merging. (The API on Render *does* auto-deploy — see `render.yaml`.)
Vercel builds `packages/web/dist` from the root `vercel.json`. The web app reads
the Play link from `appLinks.ts`, so no build-time environment variable is
required for the download buttons.

## In-app voice/video calls — TURN relay

Calls use WebRTC. STUN alone proves a peer's public address but cannot relay
media through symmetric NAT or carrier-grade NAT — which is what almost every
mobile network uses. Without a relay the call rings, the handshake finishes, and
then carries **no audio**. Clients fetch the ICE server list from
`GET /api/calls/ice-servers` **at call time**, so the relay is configured on the
API (Render) and can be added or rotated without rebuilding the web app or the
Android bundle, and the credentials never ship in the JavaScript.

Resolution order on the server (`packages/backend/src/services/iceService.ts`):

1. `TURN_URL` — any provider: Metered, Cloudflare Calls TURN, Twilio NTS, or a
   self-hosted coturn. Comma/space separated list of `turn:` / `turns:` URLs.
   Authenticate either with fixed `TURN_USERNAME` / `TURN_CREDENTIAL`, or — better
   — with `TURN_SECRET`, the TURN REST API shared secret (coturn
   `use-auth-secret`). With a secret the server mints a fresh short-lived
   credential per fetch, so no reusable relay password ever reaches a client.
   `TURN_SECRET` takes precedence if both are set.
2. Twilio Network Traversal Service — short-lived credentials minted from a
   **real** `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`. Skipped when those look
   like the `.env` placeholders, so a half-configured environment is never
   mistaken for a working relay.
3. A public Metered "Open Relay" relay — keeps calls working with no setup, but
   it is shared and rate-limited. It is offered both as a fixed-credential server
   and as a TURN REST API server using Metered's published free secret, so the
   fallback rotates credentials too.

To add a dedicated relay, set on the Render service and redeploy:

```
# Option A — fixed credentials (any provider):
TURN_URL=turn:relay.example.com:3478,turns:relay.example.com:443?transport=tcp
TURN_USERNAME=nabri
TURN_CREDENTIAL=<shared secret>

# Option B — TURN REST API (coturn use-auth-secret / Metered static auth):
# TURN_URL=turn:staticauth.openrelay.metered.ca:80,turn:staticauth.openrelay.metered.ca:443,turns:staticauth.openrelay.metered.ca:443?transport=tcp
# TURN_SECRET=<rest-api shared secret>

# optional: credential lifetime in seconds (Twilio NTS and TURN REST API), 60..86400
# TURN_TTL_SECONDS=3600
```

The response includes `source` (`env-turn`, `twilio-nts`, or `public-relay`) so
you can confirm which tier is live:

```bash
curl -H "Authorization: Bearer <accessToken>" \
  https://rentbuddy-api-s7rz.onrender.com/api/calls/ice-servers
```

## Beta testers (Google Group)

A **personal** Play developer account can only grant closed-test access through
**Google Groups**. Google's [`edits.testers`](https://developers.google.com/android-publisher/api-ref/rest/v3/edits.testers)
API accepts only a Google Group, and the "email list" method has no API at all.
Because the API cannot add members to the group either (that needs Workspace),
each applicant **joins the group themselves** — one tap from the confirmation
email. After the setup below there is no admin step.

One-time setup:

1. Create the group at <https://groups.google.com> (e.g. `nabri-beta`).
   **Live:** "Nabri Beta Testers" — `nabri-beta@googlegroups.com` —
   <https://groups.google.com/g/nabri-beta> (already created; visibility
   "Anyone on the web", join "Anyone on the web can join").
   - **Who can see group** → *Anyone on the web*
   - **Who can join group** → *Anyone can join*
2. Play Console → your app → **Closed testing → Manage track → Testers** →
   *Google Groups* → enter e.g. `nabri-beta@googlegroups.com` → **Save changes**.
3. Set `BETA_TESTER_GROUP_EMAIL` on the API (default
   `nabri-beta@googlegroups.com`) and deploy.

From then on, a submitted beta application is stored immediately and the
applicant is emailed within about a second: **Join group → Become a tester →
Install from Play**. The applications are also available as JSON/CSV at
`GET /api/admin/forms/testers` and `GET /api/admin/forms/testers.csv`.

### Emailing the invite to existing (and future) beta testers

New applications get the invitation automatically. To reach applicants who
signed up **before** the automation went live, run the backfill **from the
production server** — the email provider authorises by source IP, so a local
run is rejected:

- Admin UI: **Form Replies → "Email beta invites"**.
- Or `POST /api/admin/forms/beta-invites` (needs the `NOTIFICATIONS/CREATE`
  grant, the same as the other broadcast endpoints).

The backfill mails every unique beta applicant who has not yet been invited and
then stamps them (`FormSubmission.invitedAt`), so pressing it again only sends
to people still pending. New applications are stamped as they are confirmed, so
the two paths never double-mail the same address.

Anyone can also skip the form and join the group directly:
<https://groups.google.com/g/nabri-beta>.

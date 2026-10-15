---
name: nabri-database-security
description: Schema design, Prisma migrations, indexes, authorisation, role-based permissions, secure file uploads, privacy controls, account deletion and abuse prevention for Nabri. Load this whenever touching user data, permissions, uploads, or anything privacy-sensitive.
---

# Nabri Database & Security

## When to use this skill

Any schema change, migration, permission check, upload path, privacy setting,
report/block flow, admin capability, or anything that reads or writes user data.
If in doubt, load it — a mistake here affects real users.

## Non-negotiables

1. **Never print secrets.** No API keys, tokens, passwords, service-account
   JSON, OTPs or personal data in code, logs, commits, prompts or reports.
   Reference env vars by name only (`DATABASE_URL`, `JWT_SECRET`, …).
2. **Server-side authorisation on every private route.** The frontend hiding a
   button is not authorisation. A route that serves one user's data must check
   the session user owns it, or that a role permits it.
3. **No destructive change without a recovery plan.** Dropping a column,
   deleting rows, or rewriting history requires a backup and a stated rollback.
   Production holds real user data.
4. **Never grant admin from user signup.** Admin access is a separate path
   (`seed-admins.ts`, `ADMIN_EMAIL`, role assignment in the console).

## Schema and migrations

- `packages/backend/prisma/schema.prisma` — ~130 models. Read the surrounding
  models first and mirror their conventions (`createdAt`/`updatedAt`,
  `@default(cuid())`, relation naming).
- Migrations are in `prisma/migrations/`, applied in order. **Never edit an
  already-applied migration** — write a new one (`npm run db:migrate
  --workspace=packages/backend`).
- Add an index for any new column used in a filter, sort or uniqueness rule
  that will run across a growing table. State the query that justifies it.
- Nullable columns are the safe way to roll a new field out to existing rows.
- Referential actions (`onDelete: Cascade` vs `SetNull`) are a data-loss
  decision. Choose deliberately and say why.

## Authorisation model

- Route-level: `authenticateToken` (and friends) in `src/middleware/`.
- Role checks: `src/rbac/` plus `isAdminTierRole` / `isSuperAdminRole` in
  `packages/web/src/lib/roles.ts`. Admin surfaces live under `/admin/*` and are
  behind their own login (`/admin/login`).
- Object-level: verify ownership inside the controller — e.g. loading a post
  and checking `post.authorId === req.user!.id` before allowing an edit.
- Where a table has per-user rows, confirm the query filters by user id rather
  than returning a list and trusting the client to pick.

## File uploads

- `multer` handles uploads; disk target is `UPLOAD_DIR`. Sizes are capped by
  `MAX_FILE_SIZE` / `MAX_VIDEO_SIZE`.
- **Validate type and extension server-side.** Do not accept a client MIME
  claim alone. Reject anything outside the expected image/video types.
- Serve user binaries through the existing asset helper; never expose the raw
  filesystem path or `UPLOAD_DIR` contents.
- Content that will be publicly listed (posts, events, community posts) needs
  the existing report path wired, not a new bespoke one.

## Privacy and abuse

- **Location:** expose only approximate distance. Never surface a precise home
  point in any list or profile response.
- **Identity:** only mark a profile verified when the verification process
  actually succeeded. A pending or failed check must not render a verified
  badge.
- **Report / block** — reuse `src/routes/privacyRoutes.ts`
  (`POST /report`, `POST /block`, `DELETE /block/:id`, `GET /blocks`). Per-surface
  reports also exist for posts, communities and events. Blocking must actually
  suppress the blocked user from feeds, suggestions and messaging.
- **Account deletion:** support the existing self-deletion flow and its
  freeze window (`SELF_DELETION_FROZEN_UNTIL`). Deletion must remove or
  irreversibly anonymise personal data, not just flip a flag.
- **Rate limiting** exists via `express-rate-limit` — auth, OTP and search
  routes use it. New expensive or abuse-prone endpoints must use it too.
- **Spam controls:** `SPAM_BLOCK_WORDS` is checked on content creation. Route
  new user-generated text through the same guard.

## Configuration safety

- Env parsing lives in `src/config/env.ts` (zod). Add new vars there with
  sensible defaults so a missing value fails loudly at boot rather than
  mid-request. `isPlaceholder()` treats `"" | placeholder | changeme | dev |
  test` as unset — use that pattern instead of truthiness checks.
- Frontend code must never receive a privileged key. `VITE_*` values are
  public by construction; anything server-side stays server-side.
- An unconfigured provider must produce an honest `*_NOT_CONFIGURED` error,
  not a silent fallback that looks like success.

## Verify

- `npx tsc --noEmit` in `packages/backend`.
- `npm test --workspace=packages/backend` — includes `tests/admin-rbac.test.ts`
  and `tests/admin-security.test.ts`; run those explicitly when permissions
  change.
- For authorisation work, describe the request you would send as a
  lower-privileged user and confirm it is rejected.

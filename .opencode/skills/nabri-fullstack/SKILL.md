---
name: nabri-fullstack
description: Implementing real features across the Nabri frontend and Express/Prisma backend — routes, controllers, validation, authenticated endpoints, persistent sessions, realtime via socket.io, and wiring the UI to actual API responses. Load this for any feature that spans more than a view or needs server work.
---

# Nabri Full-stack

## When to use this skill

Adding or changing a feature that needs data to flow end to end: a new endpoint,
a new screen backed by real data, realtime updates, session/auth behaviour, or
fixing a UI that shows fake data instead of an API response.

## Architecture in one pass

- **`packages/backend`** — Express 4 + TypeScript + Prisma 5 + socket.io.
  Entry `src/app.ts` (route mounting, lines ~327–397) and `src/server.ts`.
- **`packages/web`** — React 18 + Vite 6 + React Router 6 + Capacitor 8 (Android).
  API client `src/lib/api.ts` (axios instance, attaches tokens, unwraps
  `{ data }` envelopes).
- **Deployment** — backend on Render (`https://rentbuddy-api-s7rz.onrender.com`),
  web on Vercel (`https://yuvers.in`, `https://2rent-01.vercel.app`).
  Push to `main` auto-deploys both.

A feature is not done until the web screen reads the real endpoint.

## Where things go

Follow the existing layering; the repo is consistent about it:

```
src/routes/<domain>Routes.ts     route table, validation middleware
src/controllers/<domain>Controller.ts   request handling + response shaping
src/services/<domain>Service.ts   business rules, Prisma access, side effects
```

Do not put Prisma queries in a controller if a service for that domain already
exists. Add to the service.

Mount new routers in `src/app.ts`. Unmounted routes silently 404 and look like
a frontend bug.

## Requests and responses

- Authenticated handlers take `AuthedRequest`; the user is on `req.user!`.
  Never trust an id from the client body — derive it from the session.
- Success responses use the `{ data: … }` envelope; list endpoints return
  `{ data: { items, total, page } }`. Match the shape a sibling endpoint
  already uses rather than inventing one.
- Errors go through the shared error middleware as
  `{ error: { code, message } }` with a stable machine `code`
  (e.g. `AI_NOT_CONFIGURED`, `ALREADY_REFERRED`). The web surfaces
  `getErrorMessage(err)` — never render a raw axios message.
- Validation uses `express-validator` on the route. Reject early with a field
  message; the frontend uses `react-hook-form` + `zod` in places.

## Data and migrations

- Schema: `prisma/schema.prisma` (~130 models). Additively; production holds
  real user data.
- Migration: `npm run db:migrate --workspace=packages/backend`. Never edit an
  applied migration — create a new one.
- Seed scripts live in `prisma/seed*.ts`. Never seed demo people, fake events
  or fabricated content into a shared database.

## Realtime

`useSocket` on the web, `socket.io` server on the backend with a Redis adapter
for multi-instance. Rooms are joined per conversation/thread. Events that are
not realtime must still work when the socket is down (fetch on mount).

## Auth and sessions

- Access + refresh JWT (`jose`/`jsonwebtoken`), persisted so login survives an
  app restart — **do not** clear storage on cold start.
- Roles: `USER`, `PARTNER`, `CARRY`, `ADMIN`, `SUPER_ADMIN` — see
  `src/rbac/` and the web's `lib/roles.ts`. Admin routes require
  `isAdminTierRole`; user signup must never grant an admin role.
- Third-party sign-in (Google/Apple/Firebase) only functions when its env vars
  are set; the controller returns `*_NOT_CONFIGURED` otherwise. Never fake a
  successful third-party sign-in.

## Performance

- Paginate every list (the feed caps `limit` at 50).
- Add an index when a query filters on a new column at scale — say which query.
- One request per section on a page, fetched in parallel with
  `Promise.allSettled`, so one failure does not blank the screen.

## Verify

```
npm run typecheck                      # root, all workspaces
npm test --workspace=packages/backend  # vitest, 115 files
```

Both must pass. Report the actual numbers you observed — never claim a test
ran when it did not.

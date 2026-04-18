# Professional Billing

Multi-tenant time tracking + invoicing for lawyers, consultants, accountants.
Prod: https://professionalbilling.fratellisoftware.com

## Architecture

- Single repo, three Railway services from the same GitHub:
  - **api** (`Dockerfile`, `railway.toml`) — Express HTTP server
  - **workers** (`Dockerfile`, `railway.workers.toml`) — BullMQ consumers, same image, different CMD
  - **frontend** (`/frontend/` subtree, Nixpacks auto-detect, no Dockerfile) — Vite SPA
- Postgres + Redis via Railway plugins
- Stack: Node 20, TypeScript 5.6, Express 4, Knex 3 (no ORM), Zod 3, BullMQ 5, Clerk auth, Stripe Connect, Resend email, React 19 + Vite 8 + shadcn/ui + Tailwind 4

## Repo layout

- `src/` — api + workers (shared image, entrypoint switches by `MODE`)
- `datastore/` — Knex migrations + seeds
- `frontend/` — Vite SPA (deployed via Nixpacks)
- `scripts/docker-entrypoint.sh` — routes `api` / `workers` / `migrate` modes
- `scripts/railway-bootstrap.sh` — one-time Railway provisioning helper

## Commands

Backend (from repo root):
- `npm run dev` — tsx watch
- `npm run build` — tsc + tsc-alias
- `npm test` — Mocha
- `npm run typecheck`
- `npm run migrate` — Knex migrate latest
- `npm run seed`
- `npm run setup:webhooks` — register the Stripe Connect platform webhook (idempotent; prints `STRIPE_WEBHOOK_SECRET` once on creation)
- Workers auto-detected from `package.json` `worker:*` scripts (`scripts/docker-entrypoint.sh`)

Frontend (from `/frontend`):
- `npm run dev` — Vite dev server
- `npm run build` — `tsc -b && vite build`
- `npm run typecheck`

## Multi-tenant RLS (belt-and-suspenders)

- App connects via **two** URLs: `DATABASE_URL` (superuser — migrations, workers, auth bootstrap) and `DATABASE_APP_URL` (restricted `professionalbilling_app` role — tenant requests)
- `tenantScope()` middleware (`src/middleware/tenant-scope.ts`) opens a Knex transaction on `dbApp`, sets `app.current_org_id` via `set_config()`, stores `{orgId, trx}` in AsyncLocalStorage
- Handlers use `tdb('table_name')` — never raw `db` — so queries run inside the scoped transaction and RLS policies apply
- Migrations run as superuser; workers intentionally bypass RLS for cross-org iteration
- Restricted role created idempotently by `datastore/migrations/*_create_app_role.js` using `PROFESSIONALBILLING_APP_PASSWORD` env var

## Docs registry + 3-level help

All user-facing help text lives in `corporate.docs_registry` (seeded). Frontend reads via `GET /api/docs` + `DocsRegistryContext`. UI wires with `<InfoBubble registryKey="..." />` → click opens `<InfoModal>` → "Read more" links to `/docs/:slug` full page. Never hardcode explanatory text in components.

## Stripe Connect webhooks

Platform-level pattern (one endpoint for all connected accounts):
- Endpoint: `POST /api/webhooks/stripe` — registered with `connect: true` via `npm run setup:webhooks` (idempotent list-or-create)
- Signature verified with `STRIPE_WEBHOOK_SECRET`; raw body required (route mounted in `server.ts` with `express.raw({type:'application/json'})` BEFORE `express.json()`)
- Tenant resolved by looking up `event.account` in `platforms.external_account_id`; fail-open on unknown account (200 ignored) per IntegraSentry convention
- Events enqueued on `stripe-events` BullMQ queue; processed by `src/workers/stripe-events.ts`
- Idempotency: worker checks `audit_log` for `source='stripe.worker' AND external_id=event.id AND status IN ('processed','ignored')`

## API conventions

- Swagger UI at `/api/swagger`, OpenAPI spec at `/api/openapi.json` (built via `@asteasolutions/zod-to-openapi`)
- Response envelope: `{ data: ... }`; warnings (if any) live *inside* `data`
- Webhooks (Clerk, Stripe) are idempotent — all writes go through `audit_log` regardless of outcome
- OAuth credentials encrypted AES-256-GCM as `(credentials_encrypted, credentials_iv, credentials_tag)` bytea triplet; key from `ENCRYPTION_KEY` (64 hex chars)

## Required env vars (production)

**api:** `DATABASE_URL`, `DATABASE_APP_URL`, `PROFESSIONALBILLING_APP_PASSWORD`, `REDIS_URL`, `API_BASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`, `NODE_ENV=production`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_REDIRECT_URI`, `RESEND_API_KEY` (optional)

**workers:** `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`

**frontend:** `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (both baked at build time — rebuild to change)

## Deployment notes

- Railway Nixpacks builds the frontend from `/frontend/` root directory — no Dockerfile.frontend needed, no port config needed (Nixpacks serves on `$PORT` automatically)
- api + workers share the Dockerfile; entrypoint picks behavior via `MODE` / CMD argument
- Custom domains: `professionalbilling.fratellisoftware.com` (frontend), `api.professionalbilling.fratellisoftware.com` (api)
- Migrations run automatically on api + workers boot via `docker-entrypoint.sh`
- Clerk dashboard: disable **Personal accounts** so signup forces org creation (webhooks `organization.created` + `organizationMembership.created` then populate `organizations`/`users`; `requireOrg` returns 401 without this)
- Stripe Connect OAuth: register `${API_BASE_URL}/api/oauth/callback/stripe` in https://dashboard.stripe.com/settings/connect — redirect URIs are dashboard-only (no API/CLI support)

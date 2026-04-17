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

## API conventions

- Swagger UI at `/api/swagger`, OpenAPI spec at `/api/openapi.json` (built via `@asteasolutions/zod-to-openapi`)
- Response envelope: `{ data: ... }`; warnings (if any) live *inside* `data`
- Webhooks (Clerk, Stripe) are idempotent — all writes go through `audit_log` regardless of outcome
- OAuth credentials encrypted AES-256-GCM as `(credentials_encrypted, credentials_iv, credentials_tag)` bytea triplet; key from `ENCRYPTION_KEY` (64 hex chars)

## Required env vars (production)

**api + workers:** `DATABASE_URL`, `DATABASE_APP_URL`, `PROFESSIONALBILLING_APP_PASSWORD`, `REDIS_URL`, `NODE_ENV=production`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `ENCRYPTION_KEY`, `RESEND_API_KEY` (optional in Phase 1), Stripe keys (optional in Phase 1)

**frontend:** `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (baked in at build time — rebuild frontend to change)

## Deployment notes

- Railway Nixpacks builds the frontend from `/frontend/` root directory — no Dockerfile.frontend needed, no port config needed (Nixpacks serves on `$PORT` automatically)
- api + workers share the Dockerfile; entrypoint picks behavior via `MODE` / CMD argument
- Custom domains: `professionalbilling.fratellisoftware.com` (frontend); api subdomain TBD
- Migrations run automatically on api boot via `docker-entrypoint.sh`

# Professional Billing

Professional billing for lawyers, software consultants, and accountants — time tracking, client management, invoicing (Stripe Connect or PDF), and configurable alerts. Multi-tenant with Clerk auth and Postgres RLS.

Hosted at `professionalbilling.fratellisoftware.com` on Railway.

## Local development

### 1. Bring up local infra

```bash
docker-compose up -d
```

This starts Postgres (port `5432`) and Redis (port `6379`).

### 2. Set up environment

```bash
cp .env.example .env
# Fill in CLERK_* keys, STRIPE_* keys, ENCRYPTION_KEY (openssl rand -hex 32).
```

### 3. Install + migrate + seed

```bash
npm install
npm run migrate
npm run seed
```

The `create_app_role` migration creates the `professionalbilling_app` restricted role (used by API handlers under RLS). To let that role log in locally, give it a password and set `DATABASE_APP_URL`:

```bash
psql "$DATABASE_URL" -c "ALTER ROLE professionalbilling_app WITH LOGIN PASSWORD 'app';"
# then ensure .env has:
# DATABASE_APP_URL=postgres://professionalbilling_app:app@localhost:5432/professionalbilling
```

In dev, if `DATABASE_APP_URL` is unset, the API falls back to `DATABASE_URL` (superuser, bypasses RLS). Useful for bootstrapping; don't use in production.

### 4. Run

```bash
npm run dev
```

Visit:
- API: http://localhost:3000
- Swagger UI: http://localhost:3000/api/swagger
- OpenAPI spec: http://localhost:3000/api/openapi.json
- Health: http://localhost:3000/health

### Testing an endpoint via Swagger

1. In Clerk dashboard, create a test user and copy a session JWT.
2. In Swagger UI click "Authorize", paste the JWT under `bearerAuth`.
3. Optionally set `x-org-id` under `orgIdHeader` (dev-only fallback).

## Tests

```bash
npm test            # mocha unit tests
npm run typecheck   # tsc --noEmit
npm run build       # tsc + tsc-alias (writes dist/)
```

## Deploy to Railway

One-time bootstrap (operator — not Beta):

```bash
railway login
./scripts/railway-bootstrap.sh
```

This creates the `professionalbilling` project, three services (`api`, `workers`, `frontend`), and Postgres + Redis plugins. Follow the printed manual steps to point each service at its `railway*.toml` config file and set real env vars.

## Multi-tenant isolation

Two layers of defense:

1. **App layer** — every tenant-scoped handler runs inside `tenantScope()`, which opens a Knex transaction, issues `SET LOCAL app.current_org_id = '<uuid>'`, and exposes a query-builder `tdb('table')` scoped to that transaction.
2. **DB layer** — the API connects as `professionalbilling_app` (a role without `BYPASSRLS`). RLS is enabled + FORCED on every tenant table with a policy that filters rows by `app.current_org_id`. Migrations and workers connect as the superuser (bypasses RLS).

## Repository layout

```
src/
├── config/        # env, database (db + dbApp), redis, stripe, tenant-context
├── middleware/    # auth (Clerk), tenant-scope, error-handler
├── routes/        # health, webhooks (Clerk), oauth (Stripe), docs, me, clients, time-entries
├── openapi/       # zod-to-openapi registry + generator
├── utils/         # logger, crypto (AES-256-GCM)
└── server.ts
datastore/
├── knexfile.js
├── migrations/    # timestamped .js migrations
└── seeds/production/01_docs_registry.js
frontend/         # Gamma owns this — scaffolded separately
test/unit/        # mocha + chai
```

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

## Money & rates

All monetary values in the DB and at the API boundary are **non-negative integer cents** (`hourly_rate_cents`, `rate_cents`, `default_rate_cents`, invoice totals). Zod schemas enforce `.int().nonnegative()` at request bodies.

UI inputs accept dollars with up to two decimals; converted via `parseDollarsToCents` / `formatCentsAsDollars` in `frontend/src/lib/utils.ts`. Display uses `centsToCurrency` (with `$` symbol). Never store, transmit, or compute amounts in dollars in code paths that touch the DB or API — convert only at the input/display layer.

## Time entry

Single dialog with three input modes (`frontend/src/pages/TimeEntriesPage.tsx`):
- **Duration** (default): date + start time + duration. Quick-pick chips (15/30/45/60 min) and free-form input (`90` or `1h 30m`).
- **Timer**: live tracking, persisted to `localStorage` under `professionalbilling.activeTimer`. **Single-device — does not sync across browsers/devices.** A page-level "active timer" banner stays visible whenever a timer is running, so closing the dialog doesn't hide it.
- **Start / End**: explicit `datetime-local` inputs with `step=900` (15-min snapping).

**Default rate resolution** when populating the rate field on a new entry: `clients.default_rate_cents ?? users.default_rate_cents ?? null`. Per-user default lives on `users.default_rate_cents`, edited at `/settings` (`PATCH /api/me`). Per-client override lives on `clients.default_rate_cents`, edited via the client edit modal (`PATCH /api/clients/:id`). The UI auto-populates the resolved rate; clearing the field re-engages auto-populate, so a user who has *any* default cannot accidentally save with a null rate.

`GET /api/me` returns `{ data: { user, org } }` (not flat) — `default_rate_cents` lives on `data.user`. Uses `tdb` (the `users` table has an RLS policy on `org_id`).

## Invoicing

Status flow: `draft` → `open` → `paid` (or `void` from any pre-paid state). Line items are mutable only while `draft`; `open` is immutable except for the terminal transitions.

- **Numbering:** `YYYY-NNNN`, per-org sequential, resets per calendar year. Allocated at finalize time via `invoice_sequences` with `SELECT … FOR UPDATE` inside the tenant transaction — never generate numbers client-side or out-of-band.
- **Finalize (`POST /api/invoices/:id/finalize`):** atomically assigns the number, creates a Stripe PaymentIntent on the connected account (`{stripeAccount: orgStripeAccountId}`), generates a random `payment_token` (UUID), persists `stripe_payment_intent_id` + `stripe_client_secret` + `payment_token`. Fails 424 if the org has no Stripe platform. Fails 400 if total ≤ 0 (avoids stranding a consumed sequence number on a PI-create failure).
- **Payment reconciliation:** `payment_intent.succeeded` webhook looks up the invoice by `stripe_payment_intent_id` (raw `db` in the worker, RLS bypassed) and sets `status='paid'` + `paid_at=now()`. Idempotent via the existing audit-log check.
- **Email (`POST /api/invoices/:id/send`):** enqueues `invoice-email` (BullMQ). Worker (`src/workers/invoice-email.ts`) uses Resend, builds the public payment URL server-side as `${FRONTEND_URL}/pay/${id}?token=${payment_token}`. The send endpoint itself skips delivery (audit-logged, returns `warnings: ['Email skipped — demo/test invoice']`) for any invoice that is seeded (`invoices.seeded_at IS NOT NULL`) or whose client email is on an RFC 2606 reserved `*.example.{com,org,net}` domain — avoids sending real email to demo/test clients.
- **Field-visibility rules on authenticated responses:** list never includes `stripe_client_secret`, `stripe_publishable_key`, `connected_account_id`, `payment_token`, or `paymentUrl`; detail includes `stripe_client_secret` + `stripe_publishable_key` + `connected_account_id` only when `status='open'`. `payment_token` is never returned on any authenticated response, but detail does return `paymentUrl` (which embeds the token) when `status='open'` — so the org user can click through to the public pay page directly.
- **Unbilled time entries:** `GET /api/time-entries?unbilled=true&clientId=…` excludes entries referenced by any non-`void` invoice line item (computed join, no denormalized flag).

## Public (unauthenticated) routes

Namespace: `/api/public/*`. Mounted **before** `tenantScope` in `server.ts`. Uses raw `db` — RLS is bypassed on purpose because the auth is a token carried in the URL, not a Clerk session.

Pattern (see `src/routes/public-invoices.ts`):
- Compare tokens with `crypto.timingSafeEqual` to avoid length/content timing oracles.
- Collapse "not found" and "bad token" into a single `404` — never distinguish (prevents enumeration).
- Return `410` when the resource is in a terminal state (paid, void, expired).
- Return `503` for known server-side misconfiguration (missing env/platform row) — not `500`, which implies an unexpected crash.
- Apply a per-IP rate limit (`express-rate-limit`) on every public route.

## Stripe Connect webhooks

Platform-level pattern (one endpoint for all connected accounts):
- Endpoint: `POST /api/webhooks/stripe` — registered with `connect: true` via `npm run setup:webhooks` (idempotent list-or-create)
- Signature verified with `STRIPE_WEBHOOK_SECRET`; raw body required (route mounted in `server.ts` with `express.raw({type:'application/json'})` BEFORE `express.json()`)
- Tenant resolved by looking up `event.account` in `platforms.external_account_id`; fail-open on unknown account (200 ignored) per IntegraSentry convention
- Events enqueued on `stripe-events` BullMQ queue; processed by `src/workers/stripe-events.ts`
- Idempotency: worker checks `audit_log` for `source='stripe.worker' AND external_id=event.id AND status IN ('processed','ignored')`
- Implemented handlers: `payment_intent.succeeded` flips invoice to paid. Other event types are logged + audited as stubs.
- Local testing: `stripe listen --forward-connect-to localhost:3000/api/webhooks/stripe` (Connect events, not platform events — the `--forward-to` flag would miss them).

## API conventions

- Swagger UI at `/api/swagger`, OpenAPI spec at `/api/openapi.json` (built via `@asteasolutions/zod-to-openapi`)
- Response envelope: `{ data: ... }`; warnings (if any) live *inside* `data`
- Webhooks (Clerk, Stripe) are idempotent — all writes go through `audit_log` regardless of outcome
- OAuth credentials encrypted AES-256-GCM as `(credentials_encrypted, credentials_iv, credentials_tag)` bytea triplet; key from `ENCRYPTION_KEY` (64 hex chars)

## Required env vars (production)

**api:** `DATABASE_URL`, `DATABASE_APP_URL`, `PROFESSIONALBILLING_APP_PASSWORD`, `REDIS_URL`, `API_BASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`, `NODE_ENV=production`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (read at request time by finalize/detail/public invoice endpoints; missing = 503 on public, omitted on authenticated detail), `STRIPE_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_REDIRECT_URI`, `RESEND_API_KEY` (required if `invoice-email` worker runs), `RESEND_FROM_ADDRESS` (defaults to `no-reply@professionalbilling.fratellisoftware.com`)

**workers:** `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `FRONTEND_URL` (invoice-email builds payment URL), `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`

**frontend:** `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (both baked at build time — rebuild to change)

## Deployment notes

- Railway Nixpacks builds the frontend from `/frontend/` root directory — no Dockerfile.frontend needed, no port config needed (Nixpacks serves on `$PORT` automatically)
- api + workers share the Dockerfile; entrypoint picks behavior via `MODE` / CMD argument
- Custom domains: `professionalbilling.fratellisoftware.com` (frontend), `api.professionalbilling.fratellisoftware.com` (api)
- Migrations run automatically on api + workers boot via `docker-entrypoint.sh`
- Clerk dashboard: disable **Personal accounts** so signup forces org creation (webhooks `organization.created` + `organizationMembership.created` then populate `organizations`/`users`; `requireOrg` returns 401 without this)
- Stripe Connect OAuth: register `${API_BASE_URL}/api/oauth/callback/stripe` in https://dashboard.stripe.com/settings/connect — redirect URIs are dashboard-only (no API/CLI support)

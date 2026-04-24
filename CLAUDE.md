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
- `npm test` — Mocha (globs `test/unit/**` + `test/integration/**`; integration tests self-skip when `DATABASE_URL` is unreachable, so local/CI both stay green)
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

All user-facing help text lives in `corporate.docs_registry` (seeded). Frontend reads via `GET /api/docs` + `DocsRegistryContext`. UI wires with `<InfoBubble entryKey="..." />` → click opens `<InfoModal>` → "Read more" links to `/docs/:slug` full page. Never hardcode explanatory text in components.

The registry payload lives in a single shared module `datastore/seeds/_shared/docs_registry_seed.js` (outside Knex's seed-scan dirs). Both `datastore/seeds/production/01_docs_registry.js` and `datastore/seeds/development/02_docs_registry.js` are one-line wrappers that `require` the shared module. Edit the shared file when adding registry entries — the dev/prod wrappers don't need to change.

## Onboarding tutorial

Spotlight-style overlay (`frontend/src/components/TutorialOverlay.tsx`), steps defined as data in `frontend/src/lib/tutorial-context.tsx`. Auto-opens on first mount of `ProtectedRoutes` for any user without a localStorage completion flag. Modeled after IntegraSentry's implementation (not in this workspace; fetch via `gh repo clone alphonso77/integrasentry` if you need the reference).

- **Persistence:** localStorage only, key `professionalbilling.tutorial`, shape `{ hasCompletedTutorial: boolean }`. Skip / ESC / Finish all set it to `true`. No cross-device sync by design — re-shows on each new browser.
- **Step targeting:** `targetSelector` is a CSS selector, conventionally `[data-tutorial-target="<id>"]`. Add the attribute to new nav items via the optional `tutorialTarget` field on `NavItem` in `AppShell.tsx`. Measurement uses `useLayoutEffect` for a synchronous first pass (prevents center-to-target flash) with a `requestAnimationFrame` retry loop fallback when the target isn't yet in the DOM; popover is `visibility: hidden` while the async retry is in flight.
- **Replay:** `<TutorialStartButton />` on `SettingsPage.tsx` — renders only when `hasCompletedTutorial && !isActive`, and the whole "Help & Onboarding" card is hidden when the button would render null.

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

Status flow: `draft` → `open` → `paid` → `refunded` (or `void` from any pre-paid state). Line items are mutable only while `draft`; `open` is immutable except for the terminal transitions. `refunded` is terminal — `void` is rejected on a refunded invoice.

- **Numbering:** `YYYY-NNNN`, per-org sequential, resets per calendar year. Allocated at finalize time via `invoice_sequences` with `SELECT … FOR UPDATE` inside the tenant transaction — never generate numbers client-side or out-of-band.
- **Finalize (`POST /api/invoices/:id/finalize`):** atomically assigns the `YYYY-NNNN` number, transitions status to `open`, and generates a random `payment_token` (UUID). Does NOT create the Stripe PaymentIntent — PI creation is lazy (see below). Fails 400 if total ≤ 0 (avoids stranding a consumed sequence number).
- **Lazy PaymentIntent (`src/services/ensure-payment-intent.ts`):** first view of an `open` invoice (authenticated `GET /api/invoices/:id` or public `GET /api/public/invoices/:id`) creates the PI on the connected account if missing; persists `stripe_payment_intent_id` + `stripe_client_secret`. Idempotent via the persisted columns. Uses `SELECT … FOR UPDATE` to serialize concurrent ensures. The public-pay path wraps the call in `db.transaction(...)` because the raw `db` doesn't hold a txn otherwise. 503 if the org has no Stripe platform connected.
- **Payment reconciliation:** `payment_intent.succeeded` webhook looks up the invoice by `stripe_payment_intent_id` (raw `db` in the worker, RLS bypassed) and sets `status='paid'` + `paid_at=now()`. Idempotent via the existing audit-log check.
- **Refunds:** `charge.refunded` webhook is handled by `src/workers/stripe-events.ts::handleChargeRefunded`. Invoice is looked up by `charge.payment_intent` → `stripe_payment_intent_id`. The handler works purely from the event payload — Stripe API versions from 2023+ no longer attach `charge.refunds.data` on Charge events, so we don't rely on nested Refund objects and we don't round-trip to the Stripe API. Refund amount is the delta between `charge.amount_refunded` and `event.data.previous_attributes.amount_refunded` (handles both first-refund and top-up cases). One `invoice_refunds` row per event, keyed by `stripe_event_id UNIQUE` + `ON CONFLICT … IGNORE` for event-retry idempotency. If `charge.refunded === true && charge.amount_refunded >= charge.amount`, invoice `status` flips to `'refunded'`; partial refunds keep `status='paid'` and the detail view renders the refund history. Workers bypass RLS (raw `db`); the `invoice_refunds` RLS policy is the same column-check pattern as `invoice_line_items`. Read path: `getInvoiceWithItems` loads refunds alongside line items; `GET /api/invoices/:id` returns them under `refunds` in the payload. `POST /api/invoices/:id/void` refuses (409) when status is `refunded`. The schema does not store Stripe Refund ids or reason (not in the Charge event) — if we ever need per-refund fidelity we add an API-fetch path.
- **Email (`POST /api/invoices/:id/send`):** enqueues `invoice-email` (BullMQ). Worker (`src/workers/invoice-email.ts`) uses Resend, builds the public payment URL server-side as `${FRONTEND_URL}/pay/${id}?token=${payment_token}`. Worker accepts `{ reminder?: boolean, reminderNumber?: number }` on the job payload — switches to a reminder template when `reminder: true`, audit `event_type: 'invoice.reminder.sent'` instead of `'invoice.email.sent'`. The send endpoint skips delivery (audit-logged, returns `warnings: ['Email skipped — demo/test invoice']`) per the shared `shouldSkipSend({ seededAt, email })` helper in `src/services/demo-skip.ts` — single source of truth for the seeded + RFC 2606 `*.example.{com,org,net}` rule, used by both the manual send route and the AR auto-send branch.
- **Field-visibility rules on authenticated responses:** list never includes `stripe_client_secret`, `stripe_publishable_key`, `connected_account_id`, `payment_token`, or `paymentUrl`; detail includes `stripe_client_secret` + `stripe_publishable_key` + `connected_account_id` only when `status='open'`. `payment_token` is never returned on any authenticated response, but detail does return `paymentUrl` (which embeds the token) when `status='open'` — so the org user can click through to the public pay page directly.
- **Unbilled time entries:** `GET /api/time-entries?unbilled=true&clientId=…` excludes entries referenced by any non-`void` invoice line item (computed join, no denormalized flag).
- **Seed / seeded-invoice PI gating:** `POST /api/seed` and `POST /api/seed/reseed` require Stripe test mode (`sk_test_*` / `rk_test_*`) — they return 400 `SEED_REQUIRES_TEST_MODE` otherwise. Lazy PI creation on an invoice with `seeded_at IS NOT NULL` also requires test mode; authenticated detail swallows the error and sets `paymentUnavailableReason: 'seed_requires_test_mode'` on the payload (no `stripeClientSecret`), and public-pay surfaces a 503. `DELETE /api/seed` is unguarded so cleanup is always possible.

## AR automation (Phase 2C)

Per-org scheduled invoicing + reminders. Drafts auto-generated from unbilled time entries on a configurable day of month; either auto-finalized + sent, or held in an approval queue.

- **Settings:** 6 columns on `organizations` (`ar_automation_enabled`, `ar_scope ∈ {'global','per_client'}`, `ar_run_day_of_month` 1–28, `ar_approval_required`, `ar_reminders_enabled`, `ar_reminder_cadence_days`). 4 nullable per-client overrides on `clients` (same names minus scope/run_day). `resolveEffective(org, client)` in `src/services/ar-settings.ts`: scope='global' returns org values verbatim; scope='per_client' falls back per-field to org default when override is NULL.
- **Routes:** `GET/PATCH /api/ar-settings` (org settings), `GET /api/ar-settings/preview` (dry-run, no writes), `POST /api/ar-settings/run-now` (executes against caller's org immediately, ignoring run-day). All tenant-scoped.
- **Approval flow:** auto-generated drafts have `invoices.auto_generated_at IS NOT NULL`. List with `?pendingApproval=true`. `POST /api/invoices/:id/approve-send` finalizes + sends (delegates to `handleSend` for the demo-skip path); `POST /api/invoices/:id/reject-approval` deletes the draft + line items (time entries auto-unbilled). Both 400 `NOT_AR_GENERATED` if `auto_generated_at IS NULL`, 400 `INVALID_STATUS` if not `draft`.
- **Shared executor:** `src/services/ar-executor.ts::executeAR(orgId, now, { triggeredBy, t })` — backs both the daily worker and `/run-now`. Single transaction per org. Per-client: query unbilled entries (skip `rate_cents IS NULL` with audit warning); create one draft per client with one line item per entry; if `effective.approvalRequired === false`, allocate `YYYY-NNNN`, transition to `open`, generate `payment_token`, then enqueue send via the demo-skip helper. Reminders pass: for each `open` invoice with `effective.remindersEnabled === true`, fire iff `floor((now − issue_date) / cadence) > reminders_sent_count` (strictly greater — exactly one reminder per cadence bucket even after scheduler downtime). Anchor is `issue_date` (not `sent_at` — no such column), so demo-skipped invoices still age out and increment counters.
- **Idempotency:** every run records `audit_log { source: 'ar.run', external_id: '<orgId>-<YYYY-MM-DD>' }`. Migration `20260418160300_audit_log_ar_run_idem_index.js` adds a `UNIQUE` partial index on `(org_id, external_id) WHERE source='ar.run'`. The executor's pre-check + the 23505 catch on the trailing INSERT both return `{ skipped: true, ... }` — race-safe across simultaneous scheduler + run-now.
- **Worker:** `src/workers/ar-scheduler.ts`, BullMQ queue `ar-scheduler`, repeatable cron `0 9 * * *`. Iterates orgs where `ar_automation_enabled=true AND ar_run_day_of_month = today (UTC)`. Per-org failures are caught and logged so a single bad org doesn't halt the tick. Worker uses raw `db` (RLS bypassed, standard for cross-org workers).
- **Reminder channel abstraction:** `src/services/reminder-channels.ts` — `ReminderChannel` interface + `channels` registry. v1 ships `email` only (enqueues `invoice-email` with `reminder: true`). Adding Slack/SMS later is a drop-in: implement the interface, add to the registry. The `sendReminder('email', payload)` API stays the same.
- **Frontend:** AR card on `/settings` (master toggle + scope + run day + approval + reminders + cadence). Preview + Run Now render regardless of toggle state — preview is pure read, Run Now respects all rules including demo-skip. Per-client overrides surface in the client edit modal only when org `scope === 'per_client'` (tri-state `inherit | on | off`). Pending-approval queue is a tab on `/invoices` with approve/reject row actions; nav badge on Invoices shows pending count.

## Admin + easter egg

Two boolean flags on `users`:
- `is_admin` — gates `/admin` (frontend) and `/api/admin/*` (backend via `requireAdmin` middleware, which loads `users.is_admin` via `tdb`). Founder bootstrap via `datastore/seeds/{development,production}/01_admin_bootstrap.js` — idempotent UPDATE setting `is_admin = true` for `founder@fratellisoftware.com`. Run `npm run seed` once after the founder signs up. Admins can toggle `is_admin` and `easter_egg_enabled` on any user in their org via `PATCH /api/admin/users/:id`. Last-admin guard returns 400 `LAST_ADMIN` to prevent org lockout. `AdminPage.tsx` is a tabbed surface (Users + Feedback); `/admin/users` is kept as an alias route for bookmarks from before the refactor.
- `easter_egg_enabled` — renders a pure-CSS π in the header cluster (`opacity-0 hover:opacity-40 transition`). Click opens the Seed modal. Server-side `requireEasterEgg` middleware mirrors the visibility gate.

`AppError` supports an optional `code` (3rd constructor arg). When set, the global error handler emits `{ error: { message, code } }`; otherwise it emits the legacy `{ error: message }` shape. New gates (`requireAdmin`, `requireEasterEgg`) use codes; older throw sites still use the flat shape — both coexist.

## Demo seed

Easter-egg-gated (`src/routes/seed.ts`, `src/services/seed-builder.ts`). Inserts 4 clients + 8–15 time entries each + 3 open invoices (one client left unbilled), all flagged `seeded_at = NOW()`. Deterministic per org — `mulberry32` seeded from the org id, so repeat seeds produce identical payloads.

- `POST /api/seed` — 409 if any seeded row exists. 400 `SEED_REQUIRES_TEST_MODE` if Stripe isn't in test mode.
- `POST /api/seed/reseed` — `removeSeeded` + `run`. Same test-mode guard.
- `DELETE /api/seed` — `removeSeeded` only. **Unguarded** by Stripe mode so cleanup always works.

**No Stripe API calls during seed.** Invoices are created without a PaymentIntent; the lazy-PI path creates one on first view (subject to the test-mode guard on seeded invoices in `ensurePaymentIntent`).

**`removeSeeded` semantics:**
- Cascade-delete every invoice and time_entry attached to a seeded client (seeded or not), then the seeded clients themselves. Line items cascade via existing FK. The seed modal is a demo surface, so ad-hoc user edits against seeded clients are NOT preserved — keeping them caused duplicate clients on reseed cycles.
- `invoice_sequences.next_seq` is rewound per affected year to `max(remaining_seq) + 1` (or 1 if none remain). Real invoices are never renumbered — if a gap opens mid-year, the next real invoice fills the freed number.
- Orphaned `audit_log` rows whose `external_id` references a deleted invoice (`source IN ('invoice.send','invoice-email')`) are purged inside the same transaction.
- Return shape: `{ clients, time_entries, invoices }`.

**Stripe test-mode check** (`src/utils/stripe-mode.ts`): `isStripeTestMode()` returns true iff `STRIPE_SECRET_KEY` matches `/^(sk|rk)_test_/`. Stripe Connect inherits mode from the platform key, so this single check is authoritative — no mixed-mode scenario.

## Clients

- `DELETE /api/clients/:id` refuses with `409 CLIENT_HAS_HISTORY` if the client has any invoices or time entries — `invoices.client_id` is `ON DELETE RESTRICT`, so unguarded delete would 500. Body: `{ error: { message, code: 'CLIENT_HAS_HISTORY' } }` with counts in the message.
- `?force=true` cascades (deletes invoices + time_entries + client, and purges the deleted invoices' `audit_log` rows in `invoice.send` / `invoice-email` sources) — but ONLY for seeded clients (`seeded_at IS NOT NULL`). Non-seeded + force → `400 FORCE_NOT_ALLOWED`. Mirrors `removeSeeded`'s cleanup policy.
- There is intentionally **no invoice-delete UI** for non-seeded invoices. `void` is the terminal transition for unwanted open invoices; paid invoices stay forever. Clients that accumulate real history cannot be deleted — that's the immutable-record contract real customers depend on.

## User feedback

Generic in-app feedback capture: bug / feature / ui / other. **Product-level feedback from end users to Fratelli (the developers)** — not intra-org triage. Storage lives outside the multi-tenant boundary in `corporate.feedback`, gated on the read side by a super-admin flag.

- **Table:** `corporate.feedback (id, org_id, user_id, submitter_email, org_name, type, subject, body, status, admin_note, created_at, updated_at)`. `org_id` + `user_id` are nullable FKs (`ON DELETE SET NULL`) for context only; `submitter_email` and `org_name` are denormalized at insert time so the super-admin read path doesn't need to follow FKs back into other orgs' tenant rows (and the row survives user/org deletion). Type enum: `bug | feature | ui | other`. Status enum: `pending | acknowledged | clarification_requested | resolved`. `updated_at` bumped by `corporate.update_modified_at()` trigger. **No RLS** — the corporate schema is intentionally cross-tenant; reads/writes go through the superuser `db` pool, not `tdb`.
- **Routes:** `POST /api/feedback` (still mounted under `tenantScope` so the request brings `req.userId` + `req.org!.id`; the handler then writes to `corporate.feedback` via raw `db`, denormalizing email + org_name from session-derived ids). `GET /api/feedback` returns only the caller's own rows (`user_id = req.userId`, raw `db`). Super-admin: `GET /api/admin/feedback` lists ALL rows across orgs (no org filter, no users join — denormalized columns are already on the row); `PATCH /api/admin/feedback/:id` updates `{ status?, admin_note? }`. Both gated by `requireSuperAdmin`.
- **Super-admin gate:** `users.is_super_admin` boolean (default false), bootstrapped to `true` for `founder@fratellisoftware.com` by `01_admin_bootstrap.js` in both dev and prod. New `src/middleware/require-super-admin.ts` mirrors `requireAdmin`'s shape but uses raw `db` (super-admin status is global, not org-scoped) and emits `403 NOT_SUPER_ADMIN` on miss. `/api/me` surfaces `is_super_admin` so the frontend can gate the All Users + Feedback tabs in `AdminPage.tsx`. Granting super-admin from the UI is intentionally out of scope — it's a DB-only operation, same as the founder bootstrap.
- **Cross-org users surface:** `GET /api/admin/all-users` (super-admin gated) returns every user across every org with `org_name` joined in, surfaced in the "All Users" tab on `/admin`. The existing per-org Users tab (`GET /api/admin/users`, `requireAdmin`) is unchanged — managing your own org's `is_admin` / `easter_egg_enabled` flags is still a per-org admin concern.

## Public (unauthenticated) routes

Namespace: `/api/public/*`. Mounted **before** `tenantScope` in `server.ts`. Uses raw `db` — RLS is bypassed on purpose because the auth is a token carried in the URL, not a Clerk session.

Pattern (see `src/routes/public-invoices.ts`):
- Compare tokens with `crypto.timingSafeEqual` to avoid length/content timing oracles.
- Collapse "not found" and "bad token" into a single `404` — never distinguish (prevents enumeration).
- Return `410` when the resource is in a terminal state (paid, void, expired).
- Return `503` for known server-side misconfiguration (missing env/platform row) — not `500`, which implies an unexpected crash.
- Apply a per-IP rate limit (`express-rate-limit`) on every public route.

## Offer-code signup gate

Free signup at `/sign-up` is gated behind a super-admin-issued 6-digit offer code. Codes live in `corporate.offer_codes` (cross-tenant, no RLS). Each code has `max_redemptions` (nullable = unlimited), `redemption_count`, `expires_at` (nullable), and `active`. Redemptions are logged in `corporate.offer_code_redemptions` with the Clerk `invitation_id`.

Flow: user visits `/sign-up` → enters code + email → `POST /api/public/offer-codes/redeem` → service takes a `SELECT … FOR UPDATE` on the code row, validates, calls `clerkClient.invitations.createInvitation({ emailAddress, redirectUrl: '${FRONTEND_URL}/sign-up/accept' })`, bumps `redemption_count`, inserts a redemption log row — all in one transaction. Clerk emails a signup link; the user clicks → `/sign-up/accept?__clerk_ticket=…` → Clerk's `<SignUp />` auto-binds to the ticket → completes normally → existing `organization.created` + `organizationMembership.created` webhooks populate the DB.

**Counter timing:** `redemption_count` bumps when the invitation is *sent*, not when the invited user completes signup. This caps abuse of the public redeem endpoint — an attacker with one unlimited code can't fan out infinite invitations without burning redemption slots.

**Failure-mode handling:** failure messages are intentionally generic (`INVALID_CODE` 400) for all rejection reasons (unknown / expired / exhausted / deactivated) to prevent code-probing. The public route is per-IP rate-limited (10 req/min on top of the global limiter).

**Paid signups bypass the gate** — `/api/webhooks/fratelli-signup` mints users via `clerkClient.users.createUser` directly (not via invitations), so marketing-site customers never see `/sign-up`.

**Clerk dashboard — REQUIRED:** set signup **Restrictions** to "Restricted" (i.e., invitation or allowlist required). Without this, a user could bypass the gate by visiting `/sign-up/accept` directly in an unauth'd browser and signing up without a ticket. With "Restricted" on, Clerk itself rejects signups that lack a valid ticket.

Admin UI: super-admin-only "Offer Codes" tab on `/admin` (`AdminPage.tsx`). Generate a code (random 6-digit with 10-attempt collision retry) with optional `max_redemptions` + `expires_at`. Deactivate via `POST /api/admin/offer-codes/:id/deactivate`. There is no edit flow — mint a new code instead.

## Marketing-site signup hand-off

The marketing site (`alphonso77/fratellisoftware-com`, `server/subscribe.js`) fires `POST /api/webhooks/fratelli-signup` after a paid checkout. Body is `{ event: 'signup.completed', email, stripeCustomerId, stripeSubscriptionId, trialEndAt, occurredAt }`. HMAC-SHA256 signed over the raw body with `PB_WEBHOOK_SECRET`; header `X-Fratelli-Signature: sha256=<hex>`. Route mounted with `express.raw(...)` before `express.json()` (same pattern as Stripe).

Flow: verify signature (`crypto.timingSafeEqual`) → dedup on `audit_log { source: 'fratelli.signup', external_id: stripeSubscriptionId, status: 'processed' }` → `provisionCustomer()` (`src/services/clerk-provisioning.ts`) calls `clerkClient.users.createUser` + `organizations.createOrganization`, stashing `{ stripeCustomerId, stripeSubscriptionId, trialEndAt, source: 'fratellisoftware-com' }` on the org's `publicMetadata` → enqueue `welcome-email` (Resend, 6-digit-OTP activation link to `${FRONTEND_URL}/activate?email=…`) → 200. Clerk's async `organization.created` webhook fires a second or two later; the existing `handleClerkEvent` handler reads `publicMetadata` and writes the Stripe columns on `organizations` (`stripe_customer_id`, `stripe_subscription_id`, `trial_end_at`, `signup_source`). Replay safety: `organizations.stripe_subscription_id` is UNIQUE, and `provisionCustomer` short-circuits when the email already exists (attaching Stripe data to the user's first existing org).

User lands on `/activate`, enters email (prefilled via `?email=`), Clerk emails a 6-digit code via `email_code` sign-in strategy, user enters code, signed in. No password — users created with `skipPasswordRequirement: true`. Frontend page at `frontend/src/pages/ActivatePage.tsx` using `useSignIn()` from `@clerk/clerk-react`. Requires the Clerk dashboard's **Email verification code** first-factor strategy to be enabled.

**Ops:** on the marketing-site Railway service, `PB_WEBHOOK_URL` must point at `${api.professionalbilling.fratellisoftware.com}/api/webhooks/fratelli-signup` (note the `/api` prefix — the marketing repo's default lacks it). `PB_WEBHOOK_SECRET` must match between the two services.

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

## Clerk frontend integration

`ClerkProvider` is wrapped by a local `ClerkWithRouter` component in `frontend/src/main.tsx` that reads `useNavigate()` and feeds it to ClerkProvider via `routerPush` + `routerReplace`. **This wiring is load-bearing** — without it, Clerk falls back to its own internal router and `<SignUp />` re-mounts on the verification-step transition, firing the verification email twice. `BrowserRouter` must sit OUTSIDE `ClerkProvider`. Do not reintroduce `<React.StrictMode>` at the root without first confirming the double-email bug doesn't return (StrictMode was the first, incorrect fix attempt).

## Required env vars (production)

**api:** `DATABASE_URL`, `DATABASE_APP_URL`, `PROFESSIONALBILLING_APP_PASSWORD`, `REDIS_URL`, `API_BASE_URL`, `FRONTEND_URL`, `CORS_ORIGIN`, `NODE_ENV=production`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` (read at request time by finalize/detail/public invoice endpoints; missing = 503 on public, omitted on authenticated detail), `STRIPE_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_REDIRECT_URI`, `RESEND_API_KEY` (required for invoice send + AR reminders + marketing-signup welcome email), `RESEND_FROM_ADDRESS` (defaults to `no-reply@professionalbilling.fratellisoftware.com`), `PB_WEBHOOK_SECRET` (shared with fratellisoftware-com for the signup hand-off webhook)

**`DATABASE_APP_URL` must use the restricted `professionalbilling_app` role**, not the Postgres superuser. The role is created idempotently by `datastore/migrations/*_create_app_role.js` from `PROFESSIONALBILLING_APP_PASSWORD`. URL format: `postgresql://professionalbilling_app:${{PROFESSIONALBILLING_APP_PASSWORD}}@<host>:<port>/<db>`. If superuser creds slip in, RLS is bypassed silently — Postgres exempts superusers from RLS regardless of `FORCE ROW LEVEL SECURITY`. Cross-org reads will succeed and the only symptom is "things work too well." The api boots with two startup checks (`src/services/startup-checks.ts`) that make this failure mode loud: `syncAppRolePassword` runs `ALTER ROLE professionalbilling_app WITH PASSWORD $env` on every boot (rotations no longer require a re-migration), and `assertDbAppNotSuperuser` refuses to bind a port if the dbApp pool resolves to a superuser or any role other than `professionalbilling_app`.

**`PROFESSIONALBILLING_APP_PASSWORD` alphabet constraint:** the password must be URL-safe (no `@`, `:`, `/`, `?`, `#`, `%`, no whitespace) because it's interpolated into `DATABASE_APP_URL`. The migration + startup sync both inline the value into `ALTER ROLE … PASSWORD '<pw>'` DDL with a JS-side single-quote double-up for safety. Hex (64 chars from `openssl rand -hex 32`) is the canonical choice. Special characters parse silently wrong in the URL path → the role ends up with a password the URL can't actually produce, connections fall back to whatever Railway interpolation resolves to, and RLS silently stops applying. No runtime validator — the guardrail is H1/H2 above plus this note.

**`ALTER ROLE` DDL uses plain inlining, not bound parameters.** The startup-check helper (`applyAlterRolePassword` in `src/services/startup-checks.ts`) runs `ALTER ROLE <role> WITH LOGIN PASSWORD '<escaped-pw>'` as simple DDL after doubling any single quotes in the password. The earlier `DO $do$ EXECUTE format('… %L', ?) END $do$` form fails through knex's extended query protocol — the DO block compiles as a prepared statement with zero parameter slots, so the bind array mismatches and the driver rejects it before the ALTER runs (see the 2026-04-19 prod incident in `coordination.md`). If you ever need to run DDL with dynamic values through knex, inline the value after escaping, or use identifier/literal quoting via `knex.raw('??', [name])` / `knex.raw('?', [val])` at the top-level statement — never inside a `DO` block. Covered by `test/integration/startup-checks.int.test.ts` (skips when local pg unavailable).

**Defense-in-depth org scoping:** every handler query under `src/routes/` and `src/services/` that looks up a row by id folds `org_id` into the existing `where` object literal — `tdb('invoices').where({ id, org_id: orgId }).first()`, not `.where({ id }).first()`. This is the IntegraSentry idiom; when RLS is correctly configured the redundant filter is invisible, but when it's bypassed (as in the Phase 2C UAT incident) the explicit filter is what prevents cross-org reads. Workers (`src/workers/*`) use raw `db` and intentionally skip this — cross-org iteration is part of their contract.

**workers:** `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`, `ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`, `FRONTEND_URL` (invoice-email builds payment URL; welcome-email builds `/activate` URL), `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`. The `ar-scheduler` + `welcome-email` workers also run here; no extra vars beyond the above.

**frontend:** `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_API_BASE_URL` (both baked at build time — rebuild to change)

## Deployment notes

- Railway Nixpacks builds the frontend from `/frontend/` root directory — no Dockerfile.frontend needed, no port config needed (Nixpacks serves on `$PORT` automatically)
- api + workers share the Dockerfile; entrypoint picks behavior via `MODE` / CMD argument
- Custom domains: `professionalbilling.fratellisoftware.com` (frontend), `api.professionalbilling.fratellisoftware.com` (api)
- Migrations run automatically on api + workers boot via `docker-entrypoint.sh`
- Clerk dashboard: disable **Personal accounts** so signup forces org creation (webhooks `organization.created` + `organizationMembership.created` then populate `organizations`/`users`; `requireOrg` returns 401 without this)
- Stripe Connect OAuth: register `${API_BASE_URL}/api/oauth/callback/stripe` in https://dashboard.stripe.com/settings/connect — redirect URIs are dashboard-only (no API/CLI support)

# Roadmap

## Complete

### Phase 1 — Admin + easter egg + seed (completed 2026-04-18)

* ~~time entry should not allow $0 log entries~~ — soft "pro bono?" hint instead (user may legitimately log free work)
* ADMIN menu item gated to admins (founder bootstrapped via seed)
* assign easter egg to any user (admin toggle)
* hidden π in header (CSS-only, opacity-0 until hover)
* seed modal with seed / re-seed / clean-slate (remove seed)
* seed includes clients, time entries, and unpaid invoices
* lazy Stripe PaymentIntent — no Stripe API calls during seed; PI created on first view

### Phase 2A — Lifecycle Hygiene (completed 2026-04-18)

* client delete 500 bug fixed — 409 `CLIENT_HAS_HISTORY` for non-seeded with history; `?force=true` cascade for seeded-only (400 `FORCE_NOT_ALLOWED` otherwise); symmetric `audit_log` purge on cascade
* Stripe disconnect UI wired (backend already existed)
* connect button stays disabled through OAuth redirect
* double-email signup bug fixed via `ClerkWithRouter` wrapper delegating `routerPush`/`routerReplace` to React Router (StrictMode removal alone wasn't sufficient)
* Clerk `user.deleted` webhook handler added with audit-log idempotency
* `removeSeeded` rewritten: cascade-deletes ALL descendants of seeded clients regardless of their own `seeded_at` — kills the "two Acme clients" reseed bug; `adopted` field dropped from return shape

### Phase 2C - Automate Accounts Receivable

* customer can turn on 'automated invoicing'
* customer should specify, 'global' or 'per-client' (they could say 'global' with specific client overrides)
* customer can specify whether invoice reminders are sent
* customer specifies a day of the month
* customer specifies whether it's fully automated, or gated by their approval
* each day of the month, the system reads:
    - un-attatched time logs
    - un-paid invoices
* then: the system will:
    - create invoices for all un-attached time logs
    - either: send invoices automatically, or prompt the user to approve/deny send (if configured to be gated)
    - query for all un-paid invoices, and send reminders to configured channels (if configured to send automated invoice reminders)

### Phase 2C - UAT Feedback

* clicking 'pay now' on an invoice just results in the button saying 'processing' and then hanging — downstream of the cross-org issue below; resolved with the RLS fix + correct org context
* clicking various invoices (Acme org is one) results in a 'stripe not connected for this org' message — root cause: prod `DATABASE_APP_URL` was using the Postgres root password (32 chars) instead of `${{PROFESSIONALBILLING_APP_PASSWORD}}` (64 chars), so the api was effectively running as superuser and bypassing RLS. The "Acme invoice" the user clicked actually belonged to Tim's Law Firm; cross-org isolation was leaking. Fixed by re-syncing the URL to `postgresql://professionalbilling_app:${{PROFESSIONALBILLING_APP_PASSWORD}}@postgres.railway.internal:5432/railway` and ALTER ROLE-ing the role password to match. Verified: as John's-org, Tim's invoice now returns 404 (was 503).

### Phase 2D — Onboarding tutorial

* new-user tutorial with skip + replay buttons
* use IntegraSentry implementation as the model

### Phase 2D Feedback

* there's a brief flash (quite noticible though) where the tutorial modal is first in the middle of the viewport, then it jumps to the area it's supposed to highlight
* it should finish after the last step (rather than starting over)

### Phase 2E — Feedback form, UI Enhancements

* add a nice favicon (maybe generate from a relevant emoji matching the billing theme)
* generic form capturing: bug reports, feature requests, UI feedback
* prominent 'feedback' link in the main menu
* feedback goes to our DB, surfaced in the admin area
* optional: user-side area showing their submitted feedback + status (pending, acknowledged, clarification requested)

### Phase 2D - (operational hardening)

* audit the code, RLS should be defense in depth, why didn't the app code take up the slack when the mis-configured env vars caused the RLS failure
* **remove `RESEND_API_KEY` in Railway api service** 
* **Make the app-role password drift impossible.** The `create_app_role` migration only runs once (Knex tracks it in `knex_migrations`), so rotating `PROFESSIONALBILLING_APP_PASSWORD` after first deploy silently leaves the role's password out of sync. Options:
    - Add a startup hook in `src/server.ts` that runs `ALTER ROLE professionalbilling_app WITH PASSWORD <env value>` on every boot (idempotent, cheap).
    - Or: a separate "always-runs" migration-like script invoked from `docker-entrypoint.sh` after `migrate latest`.
* **Add a fail-loud startup assertion that `DATABASE_APP_URL` is NOT a superuser.** This session's RLS leak went undetected for weeks because the only symptom was "things work too well" (cross-org reads succeeding). On boot, `SELECT current_setting('is_superuser')` against the dbApp pool — if `'on'`, log a fatal and exit. Cheap insurance against the same misconfig recurring.
* **Tighten the role password format.** `PROFESSIONALBILLING_APP_PASSWORD` is 64 chars (likely hex), so URL-encoding wasn't an issue this time, but the migration's `ALTER ROLE … PASSWORD %L` path won't survive a password with `'` or `\` characters. Document the constraint or generate the password with a known-safe alphabet.
* **Stripe Connect for Tim's Law Firm.** Demo org has no `platforms` row; either connect Stripe there (test mode) or document that AR/payment demos must be done in John's Organization.
* **Audit log retention for `oauth.deauthorize` events.** Saw 4 deauthorize events in the last 24h with no surrounding context for *why*; consider richer payload capture (which user initiated, from where) so future investigations don't have to guess.

### Phase 2D - UAT Feedback

* after clicking 'run now' in the automate accounts receivable modal, the button isn't disabled and the modal doesn't dismiss
    - looks like the user can press it a second time if they want

### Feedback architecture fix (completed 2026-04-19)

* the original feedback feature was misframed as intra-org triage (RLS-scoped `public.feedback`); it should always have been product feedback from end users → Fratelli
* moved storage to `corporate.feedback` (no RLS, denormalized `submitter_email` + `org_name`, nullable FKs `ON DELETE SET NULL` so rows survive user/org churn) — multi-tenant isolation guarantees on the `public` schema are unchanged
* added `users.is_super_admin` flag + `requireSuperAdmin` middleware (raw `db`, not org-scoped); founder bootstrapped via the existing `01_admin_bootstrap.js` seeds
* `GET /api/admin/feedback` + `PATCH /api/admin/feedback/:id` now super-admin gated and cross-org; new `GET /api/admin/all-users` surfaces every user across every org for the founder
* frontend: `AdminPage` adds "All Users" tab gated by `is_super_admin`, Feedback tab shows the org column; `FeedbackPage` copy updated to clarify Fratelli reviews submissions
* migration copies every existing `public.feedback` row into the new corporate table (denormalizing email + org_name at copy time) before dropping the old table — Timothy's submission preserved

## In Progress

* fix refund gap, we aren't processing the inbound refund hooks from stripe

## Pending

### Migrations should only run from the api

* check out the code in IntegraSentry and follow the pattern there, for how to ensure migrations only run on the api
* Today `scripts/docker-entrypoint.sh` runs `knex migrate:latest` on boot for both the `api` and `workers` services. Concurrent runs are safe (knex uses the `knex_migrations_lock` row) but wasteful, and it muddies the ownership story — workers shouldn't be a source of schema change.
* Update CLAUDE.md "Deployment notes" to document the new ownership.

### Phase 2B — Complete DB reset (admin feature)

* admin feature for a complete DB reset
    - should optionally clean up Clerk
    - or alternative: leave Clerk alone, update the app so that Clerk is the source of truth — a non-provisioned user authenticated by Clerk gets auto-provisioned on login (thoughts?)
    - optionally remove `founder@fratellisoftware.com` (in which case user gets booted and must create a new one)
    - with founder staying (mode) just leave what's necessary to log in, remove invoices, time, clients, etc.

## Phase 3

* AI enhancements
* create an AI chat concierge (in-app)
* future phase could possibly syndicate the chat into other channels (slack, discord)
* the concierge would have some abilities such as:
* given an uploaded file (.csv, calendar file, word doc, text notes) create (as applicable):
    - client list
    - time logs
    - invoices
    - basic scaffolding of data that can be garnished from the uploaded raw file
    - the user to provide context about what file is being uploaded, and what kind of information the expect to be parsed
* set up alerts for the user: "can configure an alert for when client X is more than 30 days behind?"
* basic reporting: "give me a 30, 60, 90 day summary of my expected AR"
* other features you think could be useful for this tool
* IntegraSentry has a chat-ai concierge feature already implemented - use that for architectural guidance
* in order to demonstrate the feature, create a feature to generate raw data
    - generate raw csv with basic time logs
    - generate a raw text file with notes about meetings with clients and work done



## Tracey Feedback

* have a dropdown on the time entry modal, it les you choose a category that you've preconfigured with various rates
* example: rate X is for research, rate Y is for in-court
* categories are user-defined
* have the ability to charge for hard costs - example: miles driven, filing fees
* client data entry - add the ability to enter multiple emails that get cc'd when invoices are sent
* feedback dropdown that says 'UI/UX' should be more generally understood
* retainer feature: provide a way for the user to offer a retainer
    - the user specifes a pre-paid amount
    - the user's client, makes the pre-payment
    - now the user can bill time against the pre-paid retainer
    - this offers more flexibility for users to bill clients in a different way
* offer a way for the user to allow partial payments on an invoice
* offer a payment plan option to the user's customers
    - don't use stripe subscriptions, that's not what this is meant for
    - example: a client has an ongoing case, the customer's bills are piling up
    - the customer can pay X dollars per month, and payments could get applied to the oldest invoice
* does sales tax need to be handled?
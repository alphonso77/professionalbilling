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

## In Progress

### Phase 2D — Onboarding tutorial

* new-user tutorial with skip + replay buttons
* use IntegraSentry implementation as the model

### Phase 2E — Feedback form, UI Enhancements

* add a nice favicon (maybe generate from a relevant emoji matching the billing theme)
* generic form capturing: bug reports, feature requests, UI feedback
* prominent 'feedback' link in the main menu
* feedback goes to our DB, surfaced in the admin area
* optional: user-side area showing their submitted feedback + status (pending, acknowledged, clarification requested)

## Pending

### Phase 2B — Complete DB reset (admin feature)

* admin feature for a complete DB reset
    - should optionally clean up Clerk
    - or alternative: leave Clerk alone, update the app so that Clerk is the source of truth — a non-provisioned user authenticated by Clerk gets auto-provisioned on login (thoughts?)
    - optionally remove `founder@fratellisoftware.com` (in which case user gets booted and must create a new one)
    - with founder staying (mode) just leave what's necessary to log in, remove invoices, time, clients, etc.

### Phase 2C — Auto-send invoices

* specify which date invoices go out
* invoices automatically created from un-invoiced time logs
* config at user level, with client-specific overrides

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
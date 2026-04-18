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

## In Progress

### Phase 2A — Lifecycle Hygiene (started 2026-04-18)

* client delete 500 bug
    - clients → acme corp → delete results in 500 error toast
    - seeded client with a voided invoice; FK RESTRICT on `invoices.client_id` blocks delete
    - fix: 409 `CLIENT_HAS_HISTORY` for non-seeded; `?force=true` cascade for seeded-only
    - `removeSeeded` should also clean orphaned `audit_log` rows
* Stripe disconnect UI
    - backend already exists (`DELETE /api/platforms/:id`) — only need to wire the button + confirm dialog
    - should remove the connected account from Stripe + delete DB rows (backend does both)
* connect button re-enable bug
    - clicking 'connect stripe' briefly re-enables the button before navigating to Stripe OAuth — users can double-click
* double-email signup bug
    - verification email sent twice on signup
    - same bug IntegraSentry had — React StrictMode double-render causing Clerk to double-fire
* Clerk `user.deleted` webhook
    - `organization.deleted` + `organizationMembership.deleted` already handled
    - only `user.deleted` is missing; add handler + idempotent audit-log check

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

### Phase 2D — Onboarding tutorial

* new-user tutorial with skip + replay buttons
* use IntegraSentry implementation as the model

### Phase 2E — Feedback form

* generic form capturing: bug reports, feature requests, UI feedback
* prominent 'feedback' link in the main menu
* feedback goes to our DB, surfaced in the admin area
* optional: user-side area showing their submitted feedback + status (pending, acknowledged, clarification requested)

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
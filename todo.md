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

### Phase 2D — Onboarding tutorial

* new-user tutorial with skip + replay buttons
* use IntegraSentry implementation as the model

### Phase 2E — Feedback form, UI Enhancements

* add a nice favicon (maybe generate from a relevant emoji matching the billing theme)
* generic form capturing: bug reports, feature requests, UI feedback
* prominent 'feedback' link in the main menu
* feedback goes to our DB, surfaced in the admin area
* optional: user-side area showing their submitted feedback + status (pending, acknowledged, clarification requested)

### Phase 2D Feedback

* there's a brief flash (quite noticible though) where the tutorial modal is first in the middle of the viewport, then it jumps to the area it's supposed to highlight
* it should finish after the last step (rather than starting over)

## In Progress

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

* clicking 'pay now' on an invoice just results in the button saying 'processing' and then hanging
* clicking various invoices (Acme org is one) results in a 'stripe not connected for this org' message
    - is this an artifact of me pushing and running the code prior to polish itmes, using the `founder@` account?



## Pending

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
# QuickBooks Online Integration — Proposal

**Status:** Draft / scoping
**Author:** founder@fratellisoftware.com
**Date:** 2026-04-20

## Motivation

Target market (lawyers, consultants, accountants) frequently keeps their
books in QuickBooks Online regardless of what tool they bill with. Without
a sync, every finalized invoice becomes double-entry work: once here, once
in QBO. An integration removes that friction and is table-stakes for
accountants evaluating the product.

## Principles

1. **One-way push, QBO as an accounting mirror.** ProfessionalBilling
   stays the source of truth for time, rates, invoice numbering, and
   payment. QBO receives copies for the books.
2. **Stripe remains the single payment + send rail.** We do NOT add QBO
   as an alternate "send invoice via QuickBooks" path. Two rails means
   two reconciliation paths, two status state machines, and a per-invoice
   UX choice most users won't have a confident answer to.
3. **Opt-in per org.** OAuth connect lives alongside Stripe Connect on
   the settings page. Orgs without a QBO connection see zero behavior
   change.
4. **Fail soft.** QBO sync failures never block a local invoice
   operation. Failed pushes land in a retry queue with visible status.

## In scope (v1)

| Entity | Direction | Trigger |
|---|---|---|
| Clients → QBO Customers | Push | On client create + on edit (debounced) |
| Invoices → QBO Invoices | Push | On `finalize` (status → `open`) |
| Invoice paid status | Push | On `payment_intent.succeeded` webhook |
| Invoice voided | Push | On void transition |

Line items push as a single summary line per invoice in v1 (e.g. "Legal
services — 12.5 hrs @ $350"). Detailed time-entry line items are a v2
consideration.

## Out of scope (v1)

- **Two-way sync.** No pulling QBO invoices, customers, or payments back
  into ProfessionalBilling. Conflict resolution is out of scope.
- **"Send via QuickBooks" alternative rail.** Explicitly rejected — see
  Principle 2.
- **Time-entry sync.** QBO's time module is weaker than ours and
  accountants generally don't want raw time entries cluttering their
  books. Invoices already summarize the billable work.
- **Chart of accounts mapping UI.** v1 uses a single default income
  account chosen at connect time. Per-service-type mapping is v2.
- **QuickBooks Desktop.** Online only.
- **Multi-currency.** Inherits whatever the org's QBO company is set to;
  we don't translate.

## Data model sketch

New table `qbo_connections` (tenant-scoped, one row per org):

```
id, org_id, realm_id (QBO company id), access_token_encrypted,
refresh_token_encrypted, token_iv, token_tag, token_expires_at,
default_income_account_id, connected_at, disconnected_at
```

Reuse the AES-256-GCM `ENCRYPTION_KEY` pattern already used for OAuth
credentials elsewhere (`credentials_encrypted / _iv / _tag` triplet).

New nullable columns on existing tables to carry QBO ids:

- `clients.qbo_customer_id`
- `invoices.qbo_invoice_id`

Presence of a qbo_id means "synced." Absence on a connected org means
"pending push."

New BullMQ queue `qbo-sync` with job types: `push-client`, `push-invoice`,
`mark-invoice-paid`, `mark-invoice-void`. Worker owns token refresh and
retry policy (exponential backoff, max N attempts, then park in
`audit_log` with `source: 'qbo.sync'` and a user-visible error state).

## Auth flow

Intuit OAuth 2.0 with `com.intuit.quickbooks.accounting` scope:

1. User clicks "Connect QuickBooks" on `/settings`.
2. Redirect to Intuit authorize URL with `state` = signed org id.
3. Callback at `GET /api/oauth/callback/qbo` stores tokens +
   `realm_id`, kicks off an initial backfill job that pushes all
   existing clients (not historical invoices — v1 only syncs invoices
   finalized *after* connect).
4. Refresh-token flow runs in the worker ahead of every API call (tokens
   live ~1h; refresh tokens ~100d with sliding window).

## Failure + observability

- Every QBO API call audited (`source: 'qbo.api'`, external_id = request
  id) — same pattern as `stripe.worker`.
- Sync status surfaced on invoice detail: `synced | pending | failed`
  with last-error string on failed.
- Manual "Retry sync" button on failed invoices (enqueues the same job).
- Disconnect flow revokes the token at Intuit, soft-deletes the
  `qbo_connections` row, leaves the `qbo_*_id` columns intact on clients
  and invoices so a reconnect to the same `realm_id` can reconcile.

## Phasing

**Phase 1 — Connect + clients (est. 1 week):** OAuth flow, `qbo_connections`
table, token refresh, push-client worker + backfill, settings UI card.

**Phase 2 — Invoice push (est. 1 week):** push-invoice on finalize,
mark-paid on payment succeeded, mark-void on void, sync-status UI on
invoice detail.

**Phase 3 — Hardening (est. 3–5 days):** retry UI, disconnect flow, docs
registry entries, end-to-end test against Intuit sandbox, Swagger
coverage for the new routes.

## Open questions

1. **Deleted-client semantics.** ProfessionalBilling forbids deleting
   clients with history (`CLIENT_HAS_HISTORY`). QBO lets you
   "deactivate" but not hard-delete customers with transactions. Do we
   mirror deactivation on a QBO-only workflow, or leave the customer
   untouched? (Lean: leave untouched, it's the user's books.)
2. **Invoice number collisions.** Our `YYYY-NNNN` numbering is
   per-org-sequential. QBO also wants unique invoice numbers per
   company. If a user had pre-existing QBO invoices numbered
   `2026-0001` from another tool, the push will 400. Mitigation: detect
   the collision on first push and prefix with an org-configurable
   string (e.g. `PB-2026-0001`).
3. **Sandbox vs prod toggle.** Intuit has separate sandbox / prod
   environments. Mirror the Stripe test-mode pattern? Or force prod
   only and expect users to test against a real QBO company?
4. **Line-item granularity in v1.** Single summary line is simplest but
   accountants may want per-time-entry lines so the QBO invoice matches
   what the client received. Worth validating with 2–3 target users
   before building.

## Non-goals / explicit rejections

- "Send invoices via QuickBooks" as an alternative to Stripe — rejected
  on reconciliation and UX grounds (see Principle 2).
- Pulling payment data from QBO Payments — Stripe is the payment rail;
  QBO never learns about a payment we didn't originate.
- Syncing historical (pre-connect) invoices — out of scope for v1 to
  avoid a large, error-prone backfill and accounting-period surprises.
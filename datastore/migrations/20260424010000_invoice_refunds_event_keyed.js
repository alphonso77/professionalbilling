/**
 * Pivot `invoice_refunds` from refund-object-keyed to event-keyed.
 *
 * The original table (20260423200000) assumed `charge.refunded` would carry
 * `charge.refunds.data` with Stripe Refund objects (id, reason, etc.). Stripe
 * API versions from 2023+ omit that nested list — the event payload is the
 * Charge only. We have enough in the Charge event to record the refund
 * (amount = delta from `previous_attributes.amount_refunded`, date = event's
 * `created`, PI id for invoice lookup, `refunded` flag for full-vs-partial),
 * so we key the row by `stripe_event_id` and drop the refund-object columns.
 *
 * Safe to run destructively — the table is empty in prod (prior handler
 * always returned 'ignored' because `refunds.data` was missing, so no rows
 * ever landed).
 */

exports.up = async function (knex) {
  await knex.raw(
    `ALTER TABLE invoice_refunds DROP CONSTRAINT IF EXISTS invoice_refunds_stripe_refund_id_unique`
  );
  await knex.raw(`ALTER TABLE invoice_refunds DROP COLUMN IF EXISTS stripe_refund_id`);
  await knex.raw(`ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS stripe_event_id text`);
  // Clear any rows that predate this migration and therefore have no event id.
  // The table is known-empty, but defensive.
  await knex.raw(`DELETE FROM invoice_refunds WHERE stripe_event_id IS NULL`);
  await knex.raw(`ALTER TABLE invoice_refunds ALTER COLUMN stripe_event_id SET NOT NULL`);
  await knex.raw(
    `ALTER TABLE invoice_refunds ADD CONSTRAINT invoice_refunds_stripe_event_id_unique UNIQUE (stripe_event_id)`
  );
};

exports.down = async function (knex) {
  await knex.raw(
    `ALTER TABLE invoice_refunds DROP CONSTRAINT IF EXISTS invoice_refunds_stripe_event_id_unique`
  );
  await knex.raw(`ALTER TABLE invoice_refunds DROP COLUMN IF EXISTS stripe_event_id`);
  await knex.raw(`ALTER TABLE invoice_refunds ADD COLUMN IF NOT EXISTS stripe_refund_id text`);
  await knex.raw(`DELETE FROM invoice_refunds WHERE stripe_refund_id IS NULL`);
  await knex.raw(`ALTER TABLE invoice_refunds ALTER COLUMN stripe_refund_id SET NOT NULL`);
  await knex.raw(
    `ALTER TABLE invoice_refunds ADD CONSTRAINT invoice_refunds_stripe_refund_id_unique UNIQUE (stripe_refund_id)`
  );
};

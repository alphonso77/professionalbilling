/**
 * Refund handling (Phase 2D) — per-refund-event history + `refunded` terminal
 * invoice status.
 *
 * `charge.refunded` from Stripe fires for every refund event (full or partial).
 * We record one row per Stripe Refund in `invoice_refunds` keyed by
 * `stripe_refund_id` so event retries are idempotent. The invoice's own
 * `status` is flipped to `'refunded'` only when the underlying charge is
 * fully refunded — partial refunds keep the invoice `'paid'` and the detail
 * view renders the refund history from `invoice_refunds`.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('invoice_refunds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.text('stripe_charge_id').notNullable();
    t.text('stripe_refund_id').notNullable();
    t.bigInteger('amount_cents').notNullable();
    t.text('reason');
    t.timestamp('stripe_created_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE invoice_refunds ADD CONSTRAINT invoice_refunds_stripe_refund_id_unique
      UNIQUE (stripe_refund_id)
  `);
  await knex.raw(`
    ALTER TABLE invoice_refunds ADD CONSTRAINT invoice_refunds_amount_cents_positive
      CHECK (amount_cents > 0)
  `);
  await knex.schema.alterTable('invoice_refunds', (t) => {
    t.index(['invoice_id'], 'invoice_refunds_invoice_id_idx');
    t.index(['org_id', 'created_at'], 'invoice_refunds_org_created_at_idx');
  });

  // RLS: same pattern as invoice_line_items — column check on denormalized org_id.
  await knex.raw(`ALTER TABLE invoice_refunds ENABLE ROW LEVEL SECURITY`);
  await knex.raw(`ALTER TABLE invoice_refunds FORCE ROW LEVEL SECURITY`);
  await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON invoice_refunds`);
  await knex.raw(`
    CREATE POLICY tenant_isolation ON invoice_refunds
      FOR ALL
      TO professionalbilling_app
      USING (org_id::text = current_setting('app.current_org_id', true))
      WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
  `);

  // Extend invoices.status to allow 'refunded' terminal state.
  await knex.raw(`ALTER TABLE invoices DROP CONSTRAINT invoices_status_check`);
  await knex.raw(`
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft','open','paid','void','refunded'))
  `);
};

exports.down = async function (knex) {
  await knex.raw(`ALTER TABLE invoices DROP CONSTRAINT invoices_status_check`);
  await knex.raw(`
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft','open','paid','void'))
  `);
  await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON invoice_refunds`);
  await knex.raw(`ALTER TABLE invoice_refunds DISABLE ROW LEVEL SECURITY`);
  await knex.schema.dropTableIfExists('invoice_refunds');
};

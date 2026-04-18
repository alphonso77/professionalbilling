/**
 * Invoicing v1 — invoices, invoice_line_items, invoice_sequences.
 *
 * RLS: same pattern as clients/time_entries — USING/WITH CHECK on org_id
 * vs. app.current_org_id, TO professionalbilling_app. invoice_line_items
 * carries a denormalized org_id so the policy is a plain column check
 * (cheaper + matches time_entries' style — no join-based RLS used anywhere
 * in this repo today).
 */

exports.up = async function (knex) {
  // --- invoices ---
  await knex.schema.createTable('invoices', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('client_id').notNullable().references('id').inTable('clients').onDelete('RESTRICT');
    t.text('number');
    t.text('status').notNullable().defaultTo('draft');
    t.date('issue_date');
    t.date('due_date');
    t.bigInteger('subtotal_cents').notNullable().defaultTo(0);
    t.bigInteger('total_cents').notNullable().defaultTo(0);
    t.text('notes');
    t.text('stripe_payment_intent_id');
    t.text('stripe_client_secret');
    t.text('payment_token');
    t.timestamp('paid_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
      CHECK (status IN ('draft','open','paid','void'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX invoices_org_number_unique
      ON invoices (org_id, number)
      WHERE number IS NOT NULL
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX invoices_payment_token_unique
      ON invoices (payment_token)
      WHERE payment_token IS NOT NULL
  `);
  await knex.raw(`
    CREATE TRIGGER invoices_set_updated_at
      BEFORE UPDATE ON invoices
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.alterTable('invoices', (t) => {
    t.index(['org_id', 'status'], 'invoices_org_status_idx');
    t.index(['org_id', 'client_id'], 'invoices_org_client_idx');
    t.index(['stripe_payment_intent_id'], 'invoices_stripe_pi_idx');
    t.index(['payment_token'], 'invoices_payment_token_idx');
  });

  // --- invoice_line_items ---
  await knex.schema.createTable('invoice_line_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('invoice_id').notNullable().references('id').inTable('invoices').onDelete('CASCADE');
    t.uuid('time_entry_id').references('id').inTable('time_entries').onDelete('SET NULL');
    t.text('description').notNullable();
    t.decimal('quantity_hours', 10, 2).notNullable().defaultTo(0);
    t.bigInteger('rate_cents').notNullable().defaultTo(0);
    t.bigInteger('amount_cents').notNullable().defaultTo(0);
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('invoice_line_items', (t) => {
    t.index(['invoice_id'], 'invoice_line_items_invoice_idx');
    t.index(['time_entry_id'], 'invoice_line_items_time_entry_idx');
    t.index(['org_id'], 'invoice_line_items_org_idx');
  });

  // --- invoice_sequences ---
  await knex.schema.createTable('invoice_sequences', (t) => {
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.integer('year').notNullable();
    t.integer('next_seq').notNullable().defaultTo(1);
    t.primary(['org_id', 'year']);
  });

  // --- RLS policies ---
  for (const table of ['invoices', 'invoice_line_items', 'invoice_sequences']) {
    await knex.raw(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await knex.raw(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await knex.raw(`
      CREATE POLICY tenant_isolation ON "${table}"
        FOR ALL
        TO professionalbilling_app
        USING (org_id::text = current_setting('app.current_org_id', true))
        WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
    `);
  }
};

exports.down = async function (knex) {
  for (const table of ['invoices', 'invoice_line_items', 'invoice_sequences']) {
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await knex.raw(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }
  await knex.schema.dropTableIfExists('invoice_sequences');
  await knex.schema.dropTableIfExists('invoice_line_items');
  await knex.raw('DROP TRIGGER IF EXISTS invoices_set_updated_at ON invoices');
  await knex.schema.dropTableIfExists('invoices');
};

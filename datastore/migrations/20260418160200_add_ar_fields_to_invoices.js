/**
 * Phase 2C — AR automation tracking on invoices.
 *
 * auto_generated_at: set at draft-creation time by the AR scheduler/run-now.
 *   NULL = user-created; non-NULL = pending-approval (if still draft) or
 *   auto-finalized (if open/paid).
 *
 * reminders_sent_count + last_reminder_sent_at: tracked per-invoice to power
 * the cadence guard `floor(daysSinceSent/cadence) > reminders_sent_count`.
 *
 * Partial index scoped to auto-generated invoices keeps the approval-queue
 * list endpoint fast without bloating the full index footprint.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('invoices', (t) => {
    t.timestamp('auto_generated_at', { useTz: true });
    t.integer('reminders_sent_count').notNullable().defaultTo(0);
    t.timestamp('last_reminder_sent_at', { useTz: true });
  });
  await knex.raw(`
    CREATE INDEX invoices_status_auto_generated_idx
      ON invoices(org_id, status)
      WHERE auto_generated_at IS NOT NULL
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS invoices_status_auto_generated_idx');
  await knex.schema.alterTable('invoices', (t) => {
    t.dropColumn('last_reminder_sent_at');
    t.dropColumn('reminders_sent_count');
    t.dropColumn('auto_generated_at');
  });
};

/**
 * Phase 2C — per-client AR overrides. All nullable: NULL = inherit from org.
 * Only consulted when organizations.ar_scope = 'per_client'.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.boolean('ar_automation_enabled');
    t.boolean('ar_approval_required');
    t.boolean('ar_reminders_enabled');
    t.smallint('ar_reminder_cadence_days');
  });
  await knex.raw(`
    ALTER TABLE clients ADD CONSTRAINT clients_ar_cadence_check
      CHECK (ar_reminder_cadence_days IS NULL OR ar_reminder_cadence_days > 0)
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_ar_cadence_check');
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('ar_reminder_cadence_days');
    t.dropColumn('ar_reminders_enabled');
    t.dropColumn('ar_approval_required');
    t.dropColumn('ar_automation_enabled');
  });
};

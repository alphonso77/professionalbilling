/**
 * Phase 2C — AR automation org-level settings.
 *
 * Six columns on organizations describe the org's default AR cadence.
 * ar_scope: 'global' ignores per-client overrides; 'per_client' falls back
 * per-field to the org default when the client override is NULL.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('organizations', (t) => {
    t.boolean('ar_automation_enabled').notNullable().defaultTo(false);
    t.text('ar_scope').notNullable().defaultTo('global');
    t.smallint('ar_run_day_of_month').notNullable().defaultTo(1);
    t.boolean('ar_approval_required').notNullable().defaultTo(true);
    t.boolean('ar_reminders_enabled').notNullable().defaultTo(false);
    t.smallint('ar_reminder_cadence_days').notNullable().defaultTo(30);
  });
  await knex.raw(`
    ALTER TABLE organizations ADD CONSTRAINT organizations_ar_scope_check
      CHECK (ar_scope IN ('global','per_client'))
  `);
  await knex.raw(`
    ALTER TABLE organizations ADD CONSTRAINT organizations_ar_run_day_check
      CHECK (ar_run_day_of_month BETWEEN 1 AND 28)
  `);
  await knex.raw(`
    ALTER TABLE organizations ADD CONSTRAINT organizations_ar_cadence_check
      CHECK (ar_reminder_cadence_days > 0)
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_ar_cadence_check');
  await knex.raw('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_ar_run_day_check');
  await knex.raw('ALTER TABLE organizations DROP CONSTRAINT IF EXISTS organizations_ar_scope_check');
  await knex.schema.alterTable('organizations', (t) => {
    t.dropColumn('ar_reminder_cadence_days');
    t.dropColumn('ar_reminders_enabled');
    t.dropColumn('ar_approval_required');
    t.dropColumn('ar_run_day_of_month');
    t.dropColumn('ar_scope');
    t.dropColumn('ar_automation_enabled');
  });
};

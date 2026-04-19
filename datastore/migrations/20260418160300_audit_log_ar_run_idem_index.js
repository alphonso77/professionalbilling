/**
 * Phase 2C — harden AR run idempotency.
 *
 * The ar-scheduler worker inserts an audit_log marker after each run keyed by
 * (org_id, external_id='YYYY-MM-DD'). Two concurrent scheduler firings (e.g.
 * a missed-tick catch-up overlapping the next tick) could race past the
 * pre-check and double-run. A unique partial index turns that race into a
 * clean 23505 that the executor swallows as a no-op.
 */

exports.up = async function (knex) {
  await knex.raw(`
    CREATE UNIQUE INDEX audit_log_ar_run_idem
      ON audit_log(org_id, external_id)
      WHERE source = 'ar.run'
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS audit_log_ar_run_idem');
};

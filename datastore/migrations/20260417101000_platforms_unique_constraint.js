/**
 * Replace the partial unique index on platforms(type, external_account_id) with
 * a plain non-partial UNIQUE constraint so `INSERT ... ON CONFLICT (type,
 * external_account_id)` in src/routes/oauth.ts is accepted by Postgres.
 *
 * Partial unique indexes satisfy uniqueness but Postgres rejects them as the
 * arbiter for ON CONFLICT (cols) — it requires a non-partial unique constraint
 * or index. Since every platform row (Stripe today, future OAuth providers)
 * will have an external_account_id, we also set the column NOT NULL.
 */

exports.up = async function (knex) {
  await knex.raw('DROP INDEX IF EXISTS platforms_type_external_account_unique');
  await knex.raw('ALTER TABLE platforms ALTER COLUMN external_account_id SET NOT NULL');
  await knex.raw(`
    ALTER TABLE platforms
      ADD CONSTRAINT platforms_type_external_account_key
      UNIQUE (type, external_account_id)
  `);
};

exports.down = async function (knex) {
  await knex.raw('ALTER TABLE platforms DROP CONSTRAINT IF EXISTS platforms_type_external_account_key');
  await knex.raw('ALTER TABLE platforms ALTER COLUMN external_account_id DROP NOT NULL');
  await knex.raw(`
    CREATE UNIQUE INDEX platforms_type_external_account_unique
      ON platforms (type, external_account_id)
      WHERE external_account_id IS NOT NULL
  `);
};

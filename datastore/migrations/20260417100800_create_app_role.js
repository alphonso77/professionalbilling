/**
 * Create restricted `professionalbilling_app` role for API handlers.
 *
 * - No BYPASSRLS → RLS policies (enabled in the next migration) apply.
 * - Full DML on `public` schema (where tenant tables live).
 * - Read/Select on `corporate.docs_registry` for the `/api/docs` endpoint.
 * - Idempotent: re-running the migration won't fail if the role exists.
 *
 * The password is set from PROFESSIONALBILLING_APP_PASSWORD env var if present,
 * otherwise the role stays NOLOGIN and operators can set it manually.
 *
 * PASSWORD ALPHABET CONSTRAINT: PROFESSIONALBILLING_APP_PASSWORD must be URL-safe
 * (no `@`, `:`, `/`, `?`, `#`, `%`, no whitespace) because it's interpolated into
 * DATABASE_APP_URL. Any single quotes are JS-side doubled before inlining into the
 * ALTER ROLE DDL below. Hex (64 chars from `openssl rand -hex 32`) is the
 * canonical choice and is what prod uses. Special characters parse silently
 * wrong in the URL path → cross-org data leak.
 */
exports.up = async function (knex) {
  const pw = process.env.PROFESSIONALBILLING_APP_PASSWORD;

  await knex.raw(`
    DO $$ BEGIN
      CREATE ROLE professionalbilling_app NOLOGIN NOBYPASSRLS;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  if (pw) {
    const escaped = pw.replace(/'/g, "''");
    await knex.raw(
      `ALTER ROLE professionalbilling_app WITH LOGIN PASSWORD '${escaped}'`
    );
  }

  // public schema — where tenant tables live
  await knex.raw(
    `DO $$ BEGIN EXECUTE format('GRANT CONNECT ON DATABASE %I TO professionalbilling_app', current_database()); END $$`
  );
  await knex.raw('GRANT USAGE ON SCHEMA public TO professionalbilling_app');
  await knex.raw(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO professionalbilling_app'
  );
  await knex.raw(
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO professionalbilling_app'
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO professionalbilling_app'
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO professionalbilling_app'
  );

  // corporate schema — docs registry lookups
  await knex.raw('GRANT USAGE ON SCHEMA corporate TO professionalbilling_app');
  await knex.raw(
    'GRANT SELECT ON ALL TABLES IN SCHEMA corporate TO professionalbilling_app'
  );
  await knex.raw(
    'ALTER DEFAULT PRIVILEGES IN SCHEMA corporate GRANT SELECT ON TABLES TO professionalbilling_app'
  );
};

exports.down = async function (knex) {
  await knex.raw(
    'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM professionalbilling_app'
  );
  await knex.raw(
    'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM professionalbilling_app'
  );
  await knex.raw('REVOKE USAGE ON SCHEMA public FROM professionalbilling_app');
  await knex.raw('REVOKE ALL ON ALL TABLES IN SCHEMA corporate FROM professionalbilling_app');
  await knex.raw('REVOKE USAGE ON SCHEMA corporate FROM professionalbilling_app');
  await knex.raw(
    `DO $$ BEGIN EXECUTE format('REVOKE CONNECT ON DATABASE %I FROM professionalbilling_app', current_database()); END $$`
  );
  await knex.raw('DROP ROLE IF EXISTS professionalbilling_app');
};

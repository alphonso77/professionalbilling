/**
 * Row-level security as defense-in-depth tenant isolation.
 *
 * - Enables RLS + FORCEs it on every tenant table.
 * - Policy filters rows by `app.current_org_id` (set via `SET LOCAL` from
 *   `tenantScope()` middleware).
 * - Policies are TO professionalbilling_app only; the superuser bypasses RLS
 *   for migrations, workers, and admin paths.
 * - `organizations` uses `id` directly; `users` uses `org_id` (null org_id
 *   rows are unreachable by the app role — intentional, they belong to
 *   pre-membership users).
 */

const DIRECT_ORG_TABLES = ['platforms', 'clients', 'time_entries', 'audit_log'];

exports.up = async function (knex) {
  // organizations: match by id
  await knex.raw('ALTER TABLE organizations ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE organizations FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON organizations');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON organizations
      FOR ALL
      TO professionalbilling_app
      USING (id::text = current_setting('app.current_org_id', true))
      WITH CHECK (id::text = current_setting('app.current_org_id', true))
  `);

  // users: match by org_id
  await knex.raw('ALTER TABLE users ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE users FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON users');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON users
      FOR ALL
      TO professionalbilling_app
      USING (org_id::text = current_setting('app.current_org_id', true))
      WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
  `);

  // remaining tables: match by org_id
  for (const table of DIRECT_ORG_TABLES) {
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
  const all = ['organizations', 'users', ...DIRECT_ORG_TABLES];
  for (const table of all) {
    await knex.raw(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await knex.raw(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }
};

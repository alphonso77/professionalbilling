/**
 * User feedback — per-org, tenant-scoped, RLS-protected.
 *
 * Captures in-app bug / feature / UI / other submissions. Each row belongs to
 * the submitting user's org; admins in that org triage via status + admin_note.
 * Cross-org visibility is intentionally out of scope.
 */

exports.up = async function (knex) {
  await knex.schema.createTable('feedback', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('type').notNullable();
    t.text('subject').notNullable();
    t.text('body').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('admin_note');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE feedback ADD CONSTRAINT feedback_type_check
      CHECK (type IN ('bug','feature','ui','other'))
  `);
  await knex.raw(`
    ALTER TABLE feedback ADD CONSTRAINT feedback_status_check
      CHECK (status IN ('pending','acknowledged','clarification_requested','resolved'))
  `);
  await knex.raw(`
    CREATE TRIGGER feedback_set_updated_at
      BEFORE UPDATE ON feedback
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.alterTable('feedback', (t) => {
    t.index(['org_id'], 'feedback_org_id_idx');
    t.index(['user_id'], 'feedback_user_id_idx');
  });

  await knex.raw('ALTER TABLE feedback ENABLE ROW LEVEL SECURITY');
  await knex.raw('ALTER TABLE feedback FORCE ROW LEVEL SECURITY');
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON feedback');
  await knex.raw(`
    CREATE POLICY tenant_isolation ON feedback
      FOR ALL
      TO professionalbilling_app
      USING (org_id::text = current_setting('app.current_org_id', true))
      WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON feedback');
  await knex.raw('ALTER TABLE feedback DISABLE ROW LEVEL SECURITY');
  await knex.raw('DROP TRIGGER IF EXISTS feedback_set_updated_at ON feedback');
  await knex.schema.dropTableIfExists('feedback');
};

/**
 * Move user feedback out of the tenant-scoped public.feedback table into
 * corporate.feedback. Feedback is product-level (users → developers), not
 * intra-org triage, so it must live outside the multi-tenant boundary —
 * see the "User feedback" section of CLAUDE.md.
 *
 * Denormalizes submitter_email + org_name at insert time so the super-admin
 * read path doesn't have to follow FKs back into another org's tenant rows
 * (and so the rows survive user/org deletion).
 */

exports.up = async function (knex) {
  await knex.schema.withSchema('corporate').createTable('feedback', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').references('id').inTable('public.organizations').onDelete('SET NULL');
    t.uuid('user_id').references('id').inTable('public.users').onDelete('SET NULL');
    t.text('submitter_email');
    t.text('org_name');
    t.text('type').notNullable();
    t.text('subject').notNullable();
    t.text('body').notNullable();
    t.text('status').notNullable().defaultTo('pending');
    t.text('admin_note');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw(`
    ALTER TABLE corporate.feedback ADD CONSTRAINT feedback_type_check
      CHECK (type IN ('bug','feature','ui','other'))
  `);
  await knex.raw(`
    ALTER TABLE corporate.feedback ADD CONSTRAINT feedback_status_check
      CHECK (status IN ('pending','acknowledged','clarification_requested','resolved'))
  `);
  await knex.raw(`
    CREATE TRIGGER feedback_set_updated_at
      BEFORE UPDATE ON corporate.feedback
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.withSchema('corporate').alterTable('feedback', (t) => {
    t.index(['user_id'], 'corporate_feedback_user_id_idx');
    t.index(['org_id'], 'corporate_feedback_org_id_idx');
    t.index(['created_at'], 'corporate_feedback_created_at_idx');
  });

  await knex.raw(`
    INSERT INTO corporate.feedback (
      id, org_id, user_id, submitter_email, org_name,
      type, subject, body, status, admin_note,
      created_at, updated_at
    )
    SELECT
      f.id, f.org_id, f.user_id, u.email, o.name,
      f.type, f.subject, f.body, f.status, f.admin_note,
      f.created_at, f.updated_at
    FROM public.feedback f
    LEFT JOIN public.users u ON u.id = f.user_id
    LEFT JOIN public.organizations o ON o.id = f.org_id
  `);

  await knex.raw('DROP POLICY IF EXISTS tenant_isolation ON public.feedback');
  await knex.raw('ALTER TABLE public.feedback DISABLE ROW LEVEL SECURITY');
  await knex.raw('DROP TRIGGER IF EXISTS feedback_set_updated_at ON public.feedback');
  await knex.schema.dropTableIfExists('feedback');
};

exports.down = async function (knex) {
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
  await knex.raw(`
    CREATE POLICY tenant_isolation ON feedback
      FOR ALL
      TO professionalbilling_app
      USING (org_id::text = current_setting('app.current_org_id', true))
      WITH CHECK (org_id::text = current_setting('app.current_org_id', true))
  `);

  await knex.raw(`
    INSERT INTO public.feedback (
      id, org_id, user_id, type, subject, body, status, admin_note, created_at, updated_at
    )
    SELECT id, org_id, user_id, type, subject, body, status, admin_note, created_at, updated_at
    FROM corporate.feedback
    WHERE org_id IS NOT NULL AND user_id IS NOT NULL
  `);

  await knex.raw('DROP TRIGGER IF EXISTS feedback_set_updated_at ON corporate.feedback');
  await knex.schema.withSchema('corporate').dropTableIfExists('feedback');
};

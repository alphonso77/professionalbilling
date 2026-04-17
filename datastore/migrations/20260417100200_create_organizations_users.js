exports.up = async function (knex) {
  await knex.schema.createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.text('clerk_org_id').notNullable().unique();
    t.text('name').notNullable();
    t.text('plan').notNullable().defaultTo('free');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });

  await knex.raw(`
    CREATE TRIGGER organizations_set_updated_at
      BEFORE UPDATE ON organizations
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);

  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.text('clerk_user_id').notNullable().unique();
    t.text('email');
    t.uuid('org_id').references('id').inTable('organizations').onDelete('CASCADE');
    t.text('role').notNullable().defaultTo('member');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('owner','admin','member'))
  `);
  await knex.raw(`
    CREATE TRIGGER users_set_updated_at
      BEFORE UPDATE ON users
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.alterTable('users', (t) => {
    t.index(['org_id'], 'users_org_id_idx');
  });
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS users_set_updated_at ON users');
  await knex.schema.dropTableIfExists('users');
  await knex.raw('DROP TRIGGER IF EXISTS organizations_set_updated_at ON organizations');
  await knex.schema.dropTableIfExists('organizations');
};

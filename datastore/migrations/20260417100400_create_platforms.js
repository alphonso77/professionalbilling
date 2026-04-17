exports.up = async function (knex) {
  await knex.schema.createTable('platforms', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.text('type').notNullable();
    t.text('external_account_id');
    t.specificType('credentials_encrypted', 'bytea');
    t.specificType('credentials_iv', 'bytea');
    t.specificType('credentials_tag', 'bytea');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    ALTER TABLE platforms ADD CONSTRAINT platforms_type_check
      CHECK (type IN ('stripe'))
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX platforms_type_external_account_unique
      ON platforms (type, external_account_id)
      WHERE external_account_id IS NOT NULL
  `);
  await knex.raw(`
    CREATE TRIGGER platforms_set_updated_at
      BEFORE UPDATE ON platforms
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.alterTable('platforms', (t) => {
    t.index(['org_id'], 'platforms_org_id_idx');
  });
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS platforms_set_updated_at ON platforms');
  await knex.schema.dropTableIfExists('platforms');
};

exports.up = async function (knex) {
  await knex.schema.createTable('time_entries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.uuid('client_id').references('id').inTable('clients').onDelete('SET NULL');
    t.text('description').notNullable();
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('ended_at', { useTz: true }).notNullable();
    t.integer('duration_minutes').notNullable();
    t.integer('hourly_rate_cents');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE TRIGGER time_entries_set_updated_at
      BEFORE UPDATE ON time_entries
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.raw(`
    CREATE INDEX time_entries_org_started_idx ON time_entries (org_id, started_at DESC)
  `);
  await knex.raw(`
    CREATE INDEX time_entries_org_client_idx ON time_entries (org_id, client_id)
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS time_entries_set_updated_at ON time_entries');
  await knex.schema.dropTableIfExists('time_entries');
};

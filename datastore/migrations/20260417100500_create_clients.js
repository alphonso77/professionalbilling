exports.up = async function (knex) {
  await knex.schema.createTable('clients', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id').notNullable().references('id').inTable('organizations').onDelete('CASCADE');
    t.text('name').notNullable();
    t.text('email');
    t.text('billing_address');
    t.text('notes');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.raw(`
    CREATE TRIGGER clients_set_updated_at
      BEFORE UPDATE ON clients
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.alterTable('clients', (t) => {
    t.index(['org_id'], 'clients_org_id_idx');
    t.index(['org_id', 'name'], 'clients_org_name_idx');
  });
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS clients_set_updated_at ON clients');
  await knex.schema.dropTableIfExists('clients');
};

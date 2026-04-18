exports.up = async function (knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.timestamp('seeded_at', { useTz: true });
  });
  await knex.schema.alterTable('time_entries', (t) => {
    t.timestamp('seeded_at', { useTz: true });
  });
  await knex.schema.alterTable('invoices', (t) => {
    t.timestamp('seeded_at', { useTz: true });
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('invoices', (t) => {
    t.dropColumn('seeded_at');
  });
  await knex.schema.alterTable('time_entries', (t) => {
    t.dropColumn('seeded_at');
  });
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('seeded_at');
  });
};

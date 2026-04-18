exports.up = async function (knex) {
  await knex.schema.alterTable('clients', (t) => {
    t.integer('default_rate_cents');
  });
  await knex.schema.alterTable('users', (t) => {
    t.integer('default_rate_cents');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('default_rate_cents');
  });
  await knex.schema.alterTable('clients', (t) => {
    t.dropColumn('default_rate_cents');
  });
};

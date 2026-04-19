exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('is_super_admin').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('is_super_admin');
  });
};

exports.up = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.boolean('is_admin').notNullable().defaultTo(false);
    t.boolean('easter_egg_enabled').notNullable().defaultTo(false);
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('easter_egg_enabled');
    t.dropColumn('is_admin');
  });
};

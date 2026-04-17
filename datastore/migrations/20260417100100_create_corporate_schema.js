exports.up = async function (knex) {
  await knex.raw('CREATE SCHEMA IF NOT EXISTS corporate');

  await knex.raw(`
    CREATE OR REPLACE FUNCTION corporate.update_modified_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP FUNCTION IF EXISTS corporate.update_modified_at()');
  await knex.raw('DROP SCHEMA IF EXISTS corporate CASCADE');
};

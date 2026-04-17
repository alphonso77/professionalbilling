exports.up = async function (knex) {
  await knex.raw(`
    CREATE TABLE corporate.docs_registry (
      id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT NOW()
    )
  `);
  await knex.raw(`
    CREATE TRIGGER docs_registry_set_updated_at
      BEFORE UPDATE ON corporate.docs_registry
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
};

exports.down = async function (knex) {
  await knex.raw('DROP TRIGGER IF EXISTS docs_registry_set_updated_at ON corporate.docs_registry');
  await knex.raw('DROP TABLE IF EXISTS corporate.docs_registry');
};

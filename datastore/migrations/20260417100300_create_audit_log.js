exports.up = async function (knex) {
  await knex.schema.createTable('audit_log', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('org_id')
      .references('id')
      .inTable('organizations')
      .onDelete('SET NULL');
    t.text('source').notNullable();
    t.text('event_type').notNullable();
    t.text('external_id');
    t.text('status').notNullable();
    t.jsonb('payload');
    t.text('error_detail');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema.alterTable('audit_log', (t) => {
    t.index(['source', 'event_type'], 'audit_log_source_event_idx');
    t.index(['org_id'], 'audit_log_org_id_idx');
    t.index(['created_at'], 'audit_log_created_at_idx');
  });
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('audit_log');
};

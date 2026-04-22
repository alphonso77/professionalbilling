/**
 * Offer codes — gate the free /sign-up flow so only holders of a valid code
 * can create a new org. Paid signups via the fratellisoftware-com webhook
 * are unaffected (they come in through the Stripe-verified hand-off).
 *
 * Codes are product-level (cross-tenant), so they live in the `corporate`
 * schema alongside feedback — no RLS, always read via the superuser pool.
 *
 * A redemption = we've sent a Clerk invitation to an email using this code.
 * Counting on-send (not on-user-complete) means a bad actor can't spam an
 * unlimited code endlessly — they burn a slot per attempt.
 */

exports.up = async function (knex) {
  await knex.schema.withSchema('corporate').createTable('offer_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.text('code').notNullable().unique();
    t.integer('max_redemptions').nullable();
    t.integer('redemption_count').notNullable().defaultTo(0);
    t.timestamp('expires_at', { useTz: true }).nullable();
    t.boolean('active').notNullable().defaultTo(true);
    t.uuid('created_by_user_id').references('id').inTable('public.users').onDelete('SET NULL');
    t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('updated_at', { useTz: true }).defaultTo(knex.fn.now());
    t.timestamp('deactivated_at', { useTz: true }).nullable();
  });
  await knex.raw(`
    ALTER TABLE corporate.offer_codes ADD CONSTRAINT offer_codes_code_format_check
      CHECK (code ~ '^[0-9]{6}$')
  `);
  await knex.raw(`
    ALTER TABLE corporate.offer_codes ADD CONSTRAINT offer_codes_max_redemptions_positive
      CHECK (max_redemptions IS NULL OR max_redemptions > 0)
  `);
  await knex.raw(`
    CREATE TRIGGER offer_codes_set_updated_at
      BEFORE UPDATE ON corporate.offer_codes
      FOR EACH ROW EXECUTE FUNCTION corporate.update_modified_at();
  `);
  await knex.schema.withSchema('corporate').alterTable('offer_codes', (t) => {
    t.index(['created_at'], 'corporate_offer_codes_created_at_idx');
    t.index(['active'], 'corporate_offer_codes_active_idx');
  });

  await knex.schema.withSchema('corporate').createTable('offer_code_redemptions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('uuid_generate_v4()'));
    t.uuid('offer_code_id')
      .notNullable()
      .references('id')
      .inTable('corporate.offer_codes')
      .onDelete('CASCADE');
    t.text('email').notNullable();
    t.text('clerk_invitation_id').nullable();
    t.text('ip').nullable();
    t.uuid('org_id').references('id').inTable('public.organizations').onDelete('SET NULL');
    t.timestamp('redeemed_at', { useTz: true }).defaultTo(knex.fn.now());
  });
  await knex.schema
    .withSchema('corporate')
    .alterTable('offer_code_redemptions', (t) => {
      t.index(['offer_code_id'], 'corporate_offer_code_redemptions_code_idx');
      t.index(['redeemed_at'], 'corporate_offer_code_redemptions_redeemed_at_idx');
      t.index(['email'], 'corporate_offer_code_redemptions_email_idx');
    });
};

exports.down = async function (knex) {
  await knex.schema.withSchema('corporate').dropTableIfExists('offer_code_redemptions');
  await knex.raw('DROP TRIGGER IF EXISTS offer_codes_set_updated_at ON corporate.offer_codes');
  await knex.schema.withSchema('corporate').dropTableIfExists('offer_codes');
};

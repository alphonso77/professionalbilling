/**
 * Marketing-site signup hand-off — fratellisoftware-com publishes a
 * `signup.completed` webhook after Stripe checkout. The hand-off handler
 * provisions a Clerk user + org server-side, so we need somewhere on the
 * org row to park the Stripe customer/subscription ids + trial end + the
 * source that provisioned the org.
 *
 * stripe_subscription_id is UNIQUE so a replayed webhook can't double-
 * provision (the `ON CONFLICT` in the handler relies on this).
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('organizations', (t) => {
    t.text('stripe_customer_id').nullable();
    t.text('stripe_subscription_id').nullable().unique();
    t.timestamp('trial_end_at', { useTz: true }).nullable();
    t.text('signup_source').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('organizations', (t) => {
    t.dropColumn('signup_source');
    t.dropColumn('trial_end_at');
    t.dropColumn('stripe_subscription_id');
    t.dropColumn('stripe_customer_id');
  });
};

/**
 * Marketing-site signup hand-off forwards the T&C acceptance snapshot
 * (timestamp, terms version string, and originating IP) captured when the
 * required checkbox was ticked. Park them on the org row alongside the
 * other signup-time fields (stripe_customer_id, trial_end_at, signup_source)
 * via the same publicMetadata → organization.created path.
 *
 * - terms_accepted_at is the primary signal ("they accepted at this time").
 *   Nullable so pre-existing orgs (no record on file) remain valid.
 * - terms_version records which wording they accepted — lets us decide who
 *   to re-prompt when we publish new terms without trawling Stripe.
 * - terms_accepted_ip is a legal-trail breadcrumb; IP semantics differ
 *   across IPv4/IPv6 + proxy setups, so TEXT (not INET) keeps whatever the
 *   sender captured verbatim.
 */

exports.up = async function (knex) {
  await knex.schema.alterTable('organizations', (t) => {
    t.timestamp('terms_accepted_at', { useTz: true }).nullable();
    t.text('terms_version').nullable();
    t.text('terms_accepted_ip').nullable();
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('organizations', (t) => {
    t.dropColumn('terms_accepted_ip');
    t.dropColumn('terms_version');
    t.dropColumn('terms_accepted_at');
  });
};

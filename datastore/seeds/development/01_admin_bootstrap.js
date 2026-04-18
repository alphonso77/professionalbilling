const FOUNDER_EMAIL = 'founder@fratellisoftware.com';

exports.seed = async function (knex) {
  const updated = await knex('users')
    .where({ email: FOUNDER_EMAIL, is_admin: false })
    .update({ is_admin: true });

  if (updated > 0) {
    console.log(`[admin-bootstrap] Granted is_admin to ${FOUNDER_EMAIL} (${updated} row)`);
  } else {
    console.log('[admin-bootstrap] No-op (founder not in users yet, or already admin)');
  }
};

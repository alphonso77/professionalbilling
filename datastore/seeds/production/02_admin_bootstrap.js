const FOUNDER_EMAIL = 'founder@fratellisoftware.com';

exports.seed = async function (knex) {
  const adminUpdated = await knex('users')
    .where({ email: FOUNDER_EMAIL, is_admin: false })
    .update({ is_admin: true });

  if (adminUpdated > 0) {
    console.log(`[admin-bootstrap] Granted is_admin to ${FOUNDER_EMAIL} (${adminUpdated} row)`);
  } else {
    console.log('[admin-bootstrap] is_admin no-op (founder not in users yet, or already admin)');
  }

  const superUpdated = await knex('users')
    .where({ email: FOUNDER_EMAIL, is_super_admin: false })
    .update({ is_super_admin: true });

  if (superUpdated > 0) {
    console.log(
      `[admin-bootstrap] Granted is_super_admin to ${FOUNDER_EMAIL} (${superUpdated} row)`
    );
  } else {
    console.log(
      '[admin-bootstrap] is_super_admin no-op (founder not in users yet, or already super-admin)'
    );
  }
};

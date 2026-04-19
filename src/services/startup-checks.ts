import knex, { Knex } from 'knex';

import { db, dbApp } from '../config/database';
import { logger } from '../utils/logger';

export interface SyncAppRoleResult {
  ran: boolean;
  reason?: string;
}

export interface SyncAppRoleDeps {
  /**
   * Probe the restricted role's login. Default opens a fresh knex pool on
   * `DATABASE_APP_URL`, runs `SELECT 1`, and destroys. Tests override this.
   */
  probeDbApp?: () => Promise<void>;
}

/**
 * Rewrite the `professionalbilling_app` role's password to match the
 * current `PROFESSIONALBILLING_APP_PASSWORD` env var, then verify the
 * restricted role can log in with it.
 *
 * - Runs on every API boot (idempotent `ALTER ROLE`).
 * - No-op when `PROFESSIONALBILLING_APP_PASSWORD` or `DATABASE_APP_URL` is
 *   unset — legitimate dev configuration.
 * - Throws if the env is set AND the follow-up login fails, signalling
 *   that `DATABASE_APP_URL` isn't pointing at the role we just updated.
 */
export async function syncAppRolePassword(
  superuserDb: Knex = db,
  deps: SyncAppRoleDeps = {}
): Promise<SyncAppRoleResult> {
  const pw = process.env.PROFESSIONALBILLING_APP_PASSWORD;
  if (!pw) {
    logger.warn(
      'startup-check: PROFESSIONALBILLING_APP_PASSWORD not set — syncAppRolePassword skipped'
    );
    return { ran: false, reason: 'env_not_set' };
  }
  if (!process.env.DATABASE_APP_URL) {
    logger.warn(
      'startup-check: DATABASE_APP_URL not set — syncAppRolePassword skipped'
    );
    return { ran: false, reason: 'db_app_url_not_set' };
  }

  await superuserDb.raw(
    `DO $do$
     BEGIN
       EXECUTE format('ALTER ROLE professionalbilling_app WITH LOGIN PASSWORD %L', ?);
     END
     $do$`,
    [pw]
  );

  const probe = deps.probeDbApp ?? defaultProbeDbApp;
  try {
    await probe();
  } catch (err) {
    throw new Error(
      `startup-check: ALTER ROLE succeeded but dbApp login failed — DATABASE_APP_URL likely does not reference professionalbilling_app. ${
        (err as Error).message
      }`
    );
  }

  logger.info(
    'startup-check: syncAppRolePassword ran; dbApp login verified against restricted role'
  );
  return { ran: true };
}

async function defaultProbeDbApp(): Promise<void> {
  const url = process.env.DATABASE_APP_URL;
  if (!url) throw new Error('DATABASE_APP_URL is not set');
  const probe = knex({
    client: 'pg',
    connection:
      process.env.NODE_ENV === 'production'
        ? { connectionString: url, ssl: { rejectUnauthorized: false } }
        : url,
    pool: { min: 0, max: 1 },
  });
  try {
    await probe.raw('SELECT 1');
  } finally {
    await probe.destroy();
  }
}

/**
 * Assert the dbApp pool is connected as the restricted `professionalbilling_app`
 * role (not a superuser). Postgres silently exempts superusers from RLS
 * regardless of FORCE ROW LEVEL SECURITY — so if this assertion doesn't hold,
 * the app-role transaction is effectively running without tenant isolation.
 *
 * Throws on failure; the caller decides whether to `process.exit(1)`.
 */
export async function assertDbAppNotSuperuser(dbAppPool: Knex = dbApp): Promise<void> {
  const result = (await dbAppPool.raw(
    `SELECT current_setting('is_superuser') AS s, current_user AS u`
  )) as { rows: Array<{ s: string; u: string }> };
  const row = result.rows?.[0];
  if (!row) {
    throw new Error('startup-check: dbApp probe returned no rows');
  }
  const isSuperuser = row.s === 'on';
  if (isSuperuser || row.u !== 'professionalbilling_app') {
    throw new Error(
      `startup-check: dbApp pool is not the restricted role — current_user='${row.u}', is_superuser='${row.s}'. ` +
        `DATABASE_APP_URL must connect as professionalbilling_app for RLS to apply.`
    );
  }
  logger.info(
    `startup-check: dbApp pool is restricted role ${row.u}, is_superuser=${row.s}`
  );
}

/**
 * Run all boot-time checks in order. Exits the process on failure so
 * Railway surfaces the problem rather than silently running with broken
 * tenant isolation.
 */
export async function runStartupChecks(): Promise<void> {
  try {
    await syncAppRolePassword();
    await assertDbAppNotSuperuser();
  } catch (err) {
    logger.error('FATAL: startup check failed — refusing to bind port', {
      err: (err as Error).message,
    });
    process.exit(1);
  }
}

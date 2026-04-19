import { expect } from 'chai';
import crypto from 'crypto';
import knex, { Knex } from 'knex';

import { applyAlterRolePassword } from '../../src/services/startup-checks';

/**
 * Real-pg regression test for `applyAlterRolePassword`.
 *
 * The class of bug H6 fixed (`DO $do$ EXECUTE format('…%L', ?)` compiles as a
 * prepared statement with zero param slots under knex's extended query
 * protocol) can only be caught by exercising the real driver — a mock knex
 * doesn't simulate the protocol. This test runs the helper against a
 * throwaway role and asserts it resolves; had it existed before Round 1, the
 * prod incident on 2026-04-19 would have been caught pre-deploy.
 *
 * Skips cleanly when the default DATABASE_URL isn't reachable (CI without
 * local pg, devs without Postgres installed). Uses randomized role names so
 * repeated runs don't collide, and drops the role in afterAll even if a
 * test throws.
 */

const TEST_DB_URL = process.env.DATABASE_URL;

describe('applyAlterRolePassword (real pg integration)', function () {
  this.timeout(10_000);

  let db: Knex | null = null;
  let roleName: string;

  before(async function () {
    if (!TEST_DB_URL) {
      this.skip();
    }
    const candidate = knex({
      client: 'pg',
      connection: TEST_DB_URL,
      pool: { min: 0, max: 2 },
    });
    try {
      await candidate.raw('SELECT 1');
    } catch (err) {
      await candidate.destroy().catch(() => {});
      // eslint-disable-next-line no-console
      console.warn(
        `[integration] Skipping startup-checks.int.test: cannot connect to DATABASE_URL (${
          (err as Error).message
        })`
      );
      this.skip();
    }
    db = candidate;
    roleName = `startup_check_test_role_${crypto.randomBytes(6).toString('hex')}`;
    await db.raw(`DROP ROLE IF EXISTS ${roleName}`);
    await db.raw(`CREATE ROLE ${roleName} NOLOGIN`);
  });

  after(async function () {
    if (!db) return;
    try {
      await db.raw(`DROP ROLE IF EXISTS ${roleName}`);
    } finally {
      await db.destroy();
    }
  });

  it('resolves cleanly with a hex password (protocol sanity)', async function () {
    if (!db) this.skip();
    await applyAlterRolePassword(db!, roleName, 'hex_test_password_12345');
  });

  it('resolves cleanly with a password containing a single quote (quote-safety)', async function () {
    if (!db) this.skip();
    await applyAlterRolePassword(db!, roleName, "has'quote");
  });

  it('rejects an invalid role name without touching the DB', async function () {
    if (!db) this.skip();
    let caught: unknown;
    try {
      await applyAlterRolePassword(db!, 'bad; DROP ROLE x', 'pw');
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/invalid role name/);
  });
});

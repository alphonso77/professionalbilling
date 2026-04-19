import { expect } from 'chai';
import type { Knex } from 'knex';

import {
  syncAppRolePassword,
  assertDbAppNotSuperuser,
} from '../../../src/services/startup-checks';

type RawCall = { sql: string; bindings?: unknown[] };

function makeFakeKnex(rawHandler: (sql: string, bindings?: unknown[]) => unknown) {
  const calls: RawCall[] = [];
  const fake: any = {
    async raw(sql: string, bindings?: unknown[]) {
      calls.push({ sql, bindings });
      return rawHandler(sql, bindings);
    },
  };
  return { fake: fake as Knex, calls };
}

function withEnv<T>(
  patch: Partial<Record<string, string | undefined>>,
  fn: () => Promise<T>
): Promise<T> {
  const original: Record<string, string | undefined> = {};
  for (const k of Object.keys(patch)) {
    original[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k]!;
  }
  const restore = () => {
    for (const k of Object.keys(original)) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k]!;
    }
  };
  return fn().finally(restore);
}

describe('services/startup-checks — syncAppRolePassword', () => {
  it('no-ops when PROFESSIONALBILLING_APP_PASSWORD is unset', async () => {
    const { fake, calls } = makeFakeKnex(() => ({ rows: [] }));
    const result = await withEnv(
      { PROFESSIONALBILLING_APP_PASSWORD: undefined, DATABASE_APP_URL: 'postgres://x' },
      () => syncAppRolePassword(fake)
    );
    expect(result).to.deep.equal({ ran: false, reason: 'env_not_set' });
    expect(calls).to.have.length(0);
  });

  it('no-ops when DATABASE_APP_URL is unset', async () => {
    const { fake, calls } = makeFakeKnex(() => ({ rows: [] }));
    const result = await withEnv(
      { PROFESSIONALBILLING_APP_PASSWORD: 'hexpw', DATABASE_APP_URL: undefined },
      () => syncAppRolePassword(fake)
    );
    expect(result).to.deep.equal({ ran: false, reason: 'db_app_url_not_set' });
    expect(calls).to.have.length(0);
  });

  it('issues ALTER ROLE via format(%L) with the env value as a binding', async () => {
    const { fake, calls } = makeFakeKnex(() => ({ rows: [] }));
    let probed = false;
    const result = await withEnv(
      {
        PROFESSIONALBILLING_APP_PASSWORD: 'deadbeef1234',
        DATABASE_APP_URL: 'postgres://app:pw@localhost/db',
      },
      () =>
        syncAppRolePassword(fake, {
          probeDbApp: async () => {
            probed = true;
          },
        })
    );
    expect(result).to.deep.equal({ ran: true });
    expect(calls).to.have.length(1);
    expect(calls[0].sql).to.match(/ALTER ROLE professionalbilling_app/);
    expect(calls[0].sql).to.match(/%L/);
    expect(calls[0].bindings).to.deep.equal(['deadbeef1234']);
    expect(probed).to.equal(true);
  });

  it('throws a diagnostic error when the probe login fails after ALTER ROLE', async () => {
    const { fake } = makeFakeKnex(() => ({ rows: [] }));
    let caught: unknown;
    try {
      await withEnv(
        {
          PROFESSIONALBILLING_APP_PASSWORD: 'pw',
          DATABASE_APP_URL: 'postgres://app:pw@localhost/db',
        },
        () =>
          syncAppRolePassword(fake, {
            probeDbApp: async () => {
              throw new Error('FATAL: password authentication failed');
            },
          })
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/ALTER ROLE succeeded but dbApp login failed/);
    expect((caught as Error).message).to.match(/password authentication failed/);
  });
});

describe('services/startup-checks — assertDbAppNotSuperuser', () => {
  it('resolves when connected as professionalbilling_app with is_superuser=off', async () => {
    const { fake } = makeFakeKnex(() => ({
      rows: [{ s: 'off', u: 'professionalbilling_app' }],
    }));
    await assertDbAppNotSuperuser(fake);
  });

  it('throws when is_superuser=on (even if current_user looks right)', async () => {
    const { fake } = makeFakeKnex(() => ({
      rows: [{ s: 'on', u: 'professionalbilling_app' }],
    }));
    let caught: unknown;
    try {
      await assertDbAppNotSuperuser(fake);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/not the restricted role/);
  });

  it('throws when current_user is not professionalbilling_app', async () => {
    const { fake } = makeFakeKnex(() => ({
      rows: [{ s: 'off', u: 'postgres' }],
    }));
    let caught: unknown;
    try {
      await assertDbAppNotSuperuser(fake);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/current_user='postgres'/);
  });

  it('throws when the probe returns zero rows', async () => {
    const { fake } = makeFakeKnex(() => ({ rows: [] }));
    let caught: unknown;
    try {
      await assertDbAppNotSuperuser(fake);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);
    expect((caught as Error).message).to.match(/no rows/);
  });
});

import { expect } from 'chai';
import type { Knex } from 'knex';

import {
  handleList,
  handleDelete,
  type PlatformsDeps,
} from '../../../src/routes/platforms';
import { encrypt } from '../../../src/utils/crypto';
import { AppError } from '../../../src/middleware/error-handler';
import type { DeauthorizeOpts, DeauthorizeResult } from '../../../src/services/stripe-oauth';

type Row = Record<string, unknown>;
type Table = Row[];

function makeMockDb() {
  const tables: Record<string, Table> = {
    platforms: [],
    audit_log: [],
  };

  function query(tableName: string): Knex.QueryBuilder {
    let whereClause: Partial<Row> | null = null;
    let selectedCols: string[] | null = null;

    const api: any = {
      where(clause: Partial<Row>) {
        whereClause = clause;
        return api;
      },
      select(...cols: string[]) {
        selectedCols = cols.length ? cols : null;
        return api;
      },
      orderBy(_col: string, _dir?: string) {
        return api;
      },
      async first() {
        const match = tables[tableName].find((r) =>
          whereClause ? Object.entries(whereClause).every(([k, v]) => r[k] === v) : true
        );
        if (!match) return undefined;
        return selectedCols ? project(match, selectedCols) : match;
      },
      then(resolve: (rows: Row[]) => unknown, reject?: (err: unknown) => unknown) {
        try {
          const rows = tables[tableName].filter((r) =>
            whereClause ? Object.entries(whereClause).every(([k, v]) => r[k] === v) : true
          );
          const out = selectedCols ? rows.map((r) => project(r, selectedCols!)) : rows;
          return Promise.resolve(out).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).catch(reject ?? ((e) => { throw e; }));
        }
      },
      insert(payload: Row | Row[]) {
        const payloads = Array.isArray(payload) ? payload : [payload];
        const run = async () => {
          for (const row of payloads) {
            tables[tableName].push({
              id: `mock-${tableName}-${tables[tableName].length + 1}`,
              ...row,
            });
          }
        };
        const p = run();
        return {
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) =>
          whereClause ? !Object.entries(whereClause).every(([k, v]) => r[k] === v) : false
        );
        return before - tables[tableName].length;
      },
    };
    return api as Knex.QueryBuilder;
  }

  function project(row: Row, cols: string[]): Row {
    const out: Row = {};
    for (const c of cols) out[c] = row[c];
    return out;
  }

  const mock: any = (t: string) => query(t);
  mock._tables = tables;
  mock._seedPlatform = (row: Row) => tables.platforms.push(row);
  return mock;
}

function makeEncryptedStripeCredentials(opts: {
  access_token: string;
  stripe_user_id: string;
}) {
  const enc = encrypt(
    JSON.stringify({
      access_token: opts.access_token,
      stripe_user_id: opts.stripe_user_id,
      livemode: false,
    })
  );
  return {
    credentials_encrypted: Buffer.from(enc.encrypted, 'base64'),
    credentials_iv: Buffer.from(enc.iv, 'hex'),
    credentials_tag: Buffer.from(enc.tag, 'hex'),
  };
}

function makeDeps(overrides?: {
  deauthorize?: (opts: DeauthorizeOpts) => Promise<DeauthorizeResult>;
}): PlatformsDeps & { _mock: ReturnType<typeof makeMockDb>; _deauthCalls: DeauthorizeOpts[] } {
  const mockDb = makeMockDb();
  const calls: DeauthorizeOpts[] = [];
  const deauthorize =
    overrides?.deauthorize ??
    (async (opts: DeauthorizeOpts) => {
      calls.push(opts);
      return { deauthorized: true as const };
    });
  const wrapped = async (opts: DeauthorizeOpts) => {
    calls.push(opts);
    return deauthorize(opts);
  };
  return {
    tdb: mockDb,
    db: mockDb,
    deauthorize: overrides?.deauthorize ? wrapped : deauthorize,
    _mock: mockDb,
    _deauthCalls: calls,
  };
}

describe('routes/platforms — handleList', () => {
  it('returns platforms without credential columns', async () => {
    const deps = makeDeps();
    deps._mock._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
      credentials_encrypted: Buffer.from('secret'),
      credentials_iv: Buffer.from('iv'),
      credentials_tag: Buffer.from('tag'),
      created_at: '2026-04-17T00:00:00Z',
      updated_at: '2026-04-17T00:00:00Z',
    });

    const result = await handleList(deps);

    expect(result.data).to.have.length(1);
    const [row] = result.data;
    expect(row).to.have.keys(['id', 'type', 'external_account_id', 'created_at', 'updated_at']);
    expect(row).to.not.have.property('credentials_encrypted');
    expect(row).to.not.have.property('credentials_iv');
    expect(row).to.not.have.property('credentials_tag');
  });

  it('returns an empty array when the org has no platforms', async () => {
    const deps = makeDeps();
    const result = await handleList(deps);
    expect(result.data).to.deep.equal([]);
  });
});

describe('routes/platforms — handleDelete', () => {
  it('throws 404 when no platform row matches the id', async () => {
    const deps = makeDeps();
    let caught: unknown;
    try {
      await handleDelete({ id: 'plat_missing', orgId: 'org_1' }, deps);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
    expect(deps._deauthCalls).to.have.length(0);
    expect(deps._mock._tables.audit_log).to.have.length(0);
  });

  it('success path: calls deauthorize, writes processed audit, deletes row', async () => {
    const deps = makeDeps();
    deps._mock._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
      ...makeEncryptedStripeCredentials({
        access_token: 'sk_access_token_xyz',
        stripe_user_id: 'acct_abc',
      }),
      created_at: '2026-04-17T00:00:00Z',
      updated_at: '2026-04-17T00:00:00Z',
    });

    await handleDelete({ id: 'plat_1', orgId: 'org_1' }, deps);

    expect(deps._deauthCalls).to.have.length(1);
    expect(deps._deauthCalls[0]).to.deep.equal({ stripeUserId: 'acct_abc' });
    expect(deps._mock._tables.audit_log).to.have.length(1);
    expect(deps._mock._tables.audit_log[0]).to.include({
      source: 'stripe',
      event_type: 'oauth.deauthorize',
      external_id: 'acct_abc',
      org_id: 'org_1',
      status: 'processed',
      error_detail: null,
    });
    expect(deps._mock._tables.platforms).to.have.length(0);
  });

  it('already-revoked: returns success, writes processed audit, deletes row', async () => {
    const deps = makeDeps({
      deauthorize: async () => ({ deauthorized: true, alreadyRevoked: true }),
    });
    deps._mock._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
      ...makeEncryptedStripeCredentials({
        access_token: 'sk_access_token_xyz',
        stripe_user_id: 'acct_abc',
      }),
    });

    await handleDelete({ id: 'plat_1', orgId: 'org_1' }, deps);

    expect(deps._mock._tables.audit_log[0]).to.include({
      status: 'processed',
      error_detail: null,
    });
    expect(deps._mock._tables.platforms).to.have.length(0);
  });

  it('deauthorize error: writes error audit but still deletes the row', async () => {
    const deps = makeDeps({
      deauthorize: async () => {
        throw new Error('stripe 500 internal error');
      },
    });
    deps._mock._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
      ...makeEncryptedStripeCredentials({
        access_token: 'sk_access_token_xyz',
        stripe_user_id: 'acct_abc',
      }),
    });

    await handleDelete({ id: 'plat_1', orgId: 'org_1' }, deps);

    expect(deps._mock._tables.audit_log).to.have.length(1);
    expect(deps._mock._tables.audit_log[0]).to.include({
      source: 'stripe',
      status: 'error',
      error_detail: 'stripe 500 internal error',
      external_id: 'acct_abc',
      org_id: 'org_1',
    });
    expect(deps._mock._tables.platforms).to.have.length(0);
  });
});

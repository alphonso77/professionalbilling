import { expect } from 'chai';
import { handleClerkEvent } from '../../../src/routes/webhooks';

type Row = Record<string, unknown>;
type Table = Row[];

/**
 * Minimal Knex-like builder for testing. Supports just what handleClerkEvent needs:
 *   db(tableName).where(...).select(...).first()
 *   db(tableName).where(...).count('col as alias').first()
 *   db(tableName).insert(...)                          // awaitable
 *   db(tableName).insert(...).onConflict(col).ignore()
 *   db(tableName).where(...).del()
 */
function makeMockDb() {
  const tables: Record<string, Table> = {
    organizations: [],
    users: [],
    audit_log: [],
  };

  function query(tableName: string) {
    let whereClause: Partial<Row> | null = null;
    let insertPayload: Row | Row[] | null = null;
    let countAlias: string | null = null;

    function commitInsert(conflictCol?: string) {
      const payloads = Array.isArray(insertPayload) ? insertPayload : [insertPayload!];
      for (const row of payloads) {
        if (conflictCol) {
          const conflicts = tables[tableName].some((r) => r[conflictCol] === row[conflictCol]);
          if (conflicts) continue;
        }
        const withId = { id: `mock-${tableName}-${tables[tableName].length + 1}`, ...row };
        tables[tableName].push(withId);
      }
    }

    const api: any = {
      where(clause: Partial<Row>) {
        whereClause = clause;
        return api;
      },
      select(..._cols: string[]) {
        return api;
      },
      async first() {
        if (countAlias) {
          const rows = matches(tables[tableName], whereClause);
          return { [countAlias]: rows.length };
        }
        return matches(tables[tableName], whereClause)[0];
      },
      count(expr: string) {
        const parts = expr.split(/\s+/);
        countAlias = parts[parts.length - 1];
        return api;
      },
      insert(payload: Row | Row[]) {
        insertPayload = payload;
        // Thenable so `await db('audit_log').insert(...)` commits immediately.
        return {
          onConflict(col: string | string[]) {
            const c = Array.isArray(col) ? col[0] : col;
            return {
              ignore() {
                commitInsert(c);
                return Promise.resolve();
              },
            };
          },
          then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
            try {
              commitInsert();
              resolve(undefined);
            } catch (e) {
              reject(e);
            }
          },
        };
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) => !matchesRow(r, whereClause));
        return before - tables[tableName].length;
      },
      async update(patch: Row) {
        const matched = tables[tableName].filter((r) => matchesRow(r, whereClause));
        for (const r of matched) Object.assign(r, patch);
        return matched.length;
      },
    };
    return api;
  }

  function matches(rows: Table, clause: Partial<Row> | null): Row[] {
    if (!clause) return rows.slice();
    return rows.filter((r) => matchesRow(r, clause));
  }
  function matchesRow(r: Row, clause: Partial<Row> | null): boolean {
    if (!clause) return true;
    return Object.entries(clause).every(([k, v]) => r[k] === v);
  }

  const mock: any = (t: string) => query(t);
  mock._tables = tables;
  return mock;
}

describe('routes/webhooks — handleClerkEvent', () => {
  it('organization.created inserts a new org and audit row', async () => {
    const db = makeMockDb();
    const res = await handleClerkEvent(
      { type: 'organization.created', data: { id: 'org_1', name: 'Acme' } },
      db
    );
    expect(res.status).to.equal(200);
    expect(db._tables.organizations).to.have.length(1);
    expect(db._tables.organizations[0]).to.include({ clerk_org_id: 'org_1', name: 'Acme' });
    expect(db._tables.audit_log[0]).to.include({
      event_type: 'organization.created',
      status: 'processed',
    });
  });

  it('organization.created persists Stripe subscription metadata from public_metadata', async () => {
    const db = makeMockDb();
    await handleClerkEvent(
      {
        type: 'organization.created',
        data: {
          id: 'org_1',
          name: 'Acme',
          public_metadata: {
            stripeCustomerId: 'cus_xyz',
            stripeSubscriptionId: 'sub_xyz',
            trialEndAt: 1_700_000_000_000,
            termsAcceptedAt: '2026-04-24T18:22:00.000Z',
            termsVersion: '2026-04-23',
            termsAcceptedIp: '203.0.113.42',
            source: 'fratellisoftware-com',
          },
        },
      },
      db
    );
    const org = db._tables.organizations[0];
    expect(org).to.include({
      clerk_org_id: 'org_1',
      stripe_customer_id: 'cus_xyz',
      stripe_subscription_id: 'sub_xyz',
      signup_source: 'fratellisoftware-com',
      terms_accepted_at: '2026-04-24T18:22:00.000Z',
      terms_version: '2026-04-23',
      terms_accepted_ip: '203.0.113.42',
    });
    expect(org.trial_end_at).to.equal(new Date(1_700_000_000_000).toISOString());
  });

  it('organization.created does not touch Stripe columns when public_metadata is absent', async () => {
    const db = makeMockDb();
    await handleClerkEvent(
      { type: 'organization.created', data: { id: 'org_2', name: 'Beta' } },
      db
    );
    const org = db._tables.organizations[0];
    expect(org).to.not.have.property('stripe_subscription_id');
  });

  it('organization.created ignores if org already exists', async () => {
    const db = makeMockDb();
    await handleClerkEvent({ type: 'organization.created', data: { id: 'org_1', name: 'Acme' } }, db);
    await handleClerkEvent({ type: 'organization.created', data: { id: 'org_1', name: 'Acme' } }, db);
    expect(db._tables.organizations).to.have.length(1);
    expect(db._tables.audit_log.pop()).to.include({ status: 'ignored' });
  });

  it('organization.deleted removes the org row', async () => {
    const db = makeMockDb();
    await handleClerkEvent({ type: 'organization.created', data: { id: 'org_1', name: 'Acme' } }, db);
    const res = await handleClerkEvent(
      { type: 'organization.deleted', data: { id: 'org_1' } },
      db
    );
    expect(res.status).to.equal(200);
    expect(db._tables.organizations).to.have.length(0);
  });

  it('user.created writes an audit-only row', async () => {
    const db = makeMockDb();
    const res = await handleClerkEvent({ type: 'user.created', data: { id: 'user_1' } }, db);
    expect(res.status).to.equal(200);
    expect(db._tables.users).to.have.length(0);
    expect(db._tables.audit_log[0]).to.include({
      event_type: 'user.created',
      status: 'processed',
    });
  });

  it('organizationMembership.created — first member becomes owner', async () => {
    const db = makeMockDb();
    await handleClerkEvent(
      {
        type: 'organizationMembership.created',
        data: {
          organization: { id: 'org_1', name: 'Acme' },
          public_user_data: { user_id: 'user_1', identifier: 'founder@acme.com' },
        },
      },
      db
    );
    expect(db._tables.users).to.have.length(1);
    expect(db._tables.users[0]).to.include({ role: 'owner', email: 'founder@acme.com' });
  });

  it('organizationMembership.created — subsequent member becomes member', async () => {
    const db = makeMockDb();
    await handleClerkEvent(
      {
        type: 'organizationMembership.created',
        data: {
          organization: { id: 'org_1', name: 'Acme' },
          public_user_data: { user_id: 'user_1', identifier: 'a@acme.com' },
        },
      },
      db
    );
    await handleClerkEvent(
      {
        type: 'organizationMembership.created',
        data: {
          organization: { id: 'org_1', name: 'Acme' },
          public_user_data: { user_id: 'user_2', identifier: 'b@acme.com' },
        },
      },
      db
    );
    const second = db._tables.users.find((u: any) => u.clerk_user_id === 'user_2');
    expect(second).to.include({ role: 'member' });
  });

  it('organizationMembership.deleted removes the user row', async () => {
    const db = makeMockDb();
    await handleClerkEvent(
      {
        type: 'organizationMembership.created',
        data: {
          organization: { id: 'org_1', name: 'Acme' },
          public_user_data: { user_id: 'user_1', identifier: 'a@acme.com' },
        },
      },
      db
    );
    expect(db._tables.users).to.have.length(1);

    const res = await handleClerkEvent(
      {
        type: 'organizationMembership.deleted',
        data: {
          organization: { id: 'org_1' },
          public_user_data: { user_id: 'user_1' },
        },
      },
      db
    );
    expect(res.status).to.equal(200);
    expect(db._tables.users).to.have.length(0);
  });

  it('unknown event types are logged as ignored', async () => {
    const db = makeMockDb();
    const res = await handleClerkEvent({ type: 'session.created', data: {} }, db);
    expect(res.status).to.equal(200);
    expect(db._tables.audit_log[0]).to.include({ status: 'ignored' });
  });
});

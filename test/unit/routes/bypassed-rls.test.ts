import { expect } from 'chai';
import type { Knex } from 'knex';

import {
  handleGet as handleClientGet,
  handleList as handleClientList,
} from '../../../src/routes/clients';
import { handleMe } from '../../../src/routes/me';
import { handleGet as handleInvoiceGet } from '../../../src/routes/invoices';
import { AppError } from '../../../src/middleware/error-handler';
import { runWithTenantContext } from '../../../src/config/tenant-context';
import type { AuthenticatedRequest } from '../../../src/middleware/auth';

/**
 * These tests prove the H4 defense-in-depth property: even when RLS is
 * silently bypassed (the Phase 2C UAT failure mode), the handlers' explicit
 * `where({ id, org_id: orgId })` filters still return 404 for cross-org ids.
 *
 * The mock DB below does NOT simulate RLS. The only row filtering it applies
 * is whatever the handler passes in `.where(...)`. So:
 *   - If the handler's query is `.where({ id })` — the cross-org row leaks.
 *   - If the handler's query is `.where({ id, org_id: orgA })` — 404.
 *
 * That matches the production failure mode exactly: a misconfigured DATABASE_APP_URL
 * that connects as the superuser silently bypasses RLS → handler-level scoping
 * is the only remaining protection.
 */

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

interface MockBuilder {
  where(cond: Row): MockBuilder;
  whereNot(cond: Row): MockBuilder;
  whereIn(_col: string, _values: unknown[]): MockBuilder;
  select(...cols: unknown[]): MockBuilder;
  orderBy(_col: string, _dir?: string): MockBuilder;
  first(): Promise<Row | undefined>;
  update(patch: Row): MockBuilder;
  insert(rows: Row | Row[]): Promise<void> & { returning?: (cols: string[]) => Promise<Row[]> };
  del(): Promise<number>;
  then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown): Promise<unknown>;
}

function makeMockDb(tables: Tables) {
  function query(tableName: string): MockBuilder {
    if (!(tableName in tables)) tables[tableName] = [];
    const conditions: Array<(r: Row) => boolean> = [];
    let selectedCols: string[] | null = null;

    const api: any = {
      where(cond: Row) {
        conditions.push((r) =>
          Object.entries(cond).every(([k, v]) => {
            const key = k.includes('.') ? k.split('.').pop()! : k;
            return r[key] === v;
          })
        );
        return api;
      },
      whereNot(_cond: Row) {
        return api;
      },
      whereIn(_col: string, _values: unknown[]) {
        return api;
      },
      select(...cols: unknown[]) {
        const flat: string[] = [];
        for (const c of cols) {
          if (Array.isArray(c)) flat.push(...(c as string[]));
          else flat.push(c as string);
        }
        selectedCols = flat.length ? flat : null;
        return api;
      },
      orderBy(_col: string, _dir?: string) {
        return api;
      },
      async first() {
        return runSelect()[0];
      },
      update(patch: Row) {
        const matched = tables[tableName].filter((r) => conditions.every((c) => c(r)));
        for (const r of matched) Object.assign(r, patch);
        const thenable: any = Promise.resolve(matched.length);
        thenable.returning = async (_cols: string[]) => matched;
        return thenable;
      },
      insert(_payload: Row | Row[]) {
        return Promise.resolve();
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) => !conditions.every((c) => c(r)));
        return before - tables[tableName].length;
      },
      then(resolve: (rows: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(runSelect()).then(resolve, reject);
      },
    };

    function runSelect(): Row[] {
      let rows = tables[tableName].slice();
      if (conditions.length) rows = rows.filter((r) => conditions.every((c) => c(r)));
      if (selectedCols) {
        rows = rows.map((r) => {
          const o: Row = {};
          for (const c of selectedCols!) o[c] = r[c];
          return o;
        });
      }
      return rows;
    }

    return api as MockBuilder;
  }
  return query as unknown as Knex.Transaction;
}

function fakeReq(opts: {
  userId?: string;
  orgId: string;
  params?: Row;
  body?: Row;
  query?: Row;
}): AuthenticatedRequest {
  return {
    userId: opts.userId,
    org: { id: opts.orgId, clerk_org_id: 'clerk_' + opts.orgId, plan: 'free' },
    params: opts.params ?? {},
    body: opts.body ?? {},
    query: opts.query ?? {},
  } as unknown as AuthenticatedRequest;
}

const ORG_A = '00000000-0000-0000-0000-0000000000aa';
const ORG_B = '00000000-0000-0000-0000-0000000000bb';
const ID_B = '00000000-0000-0000-0000-000000000bb1';

describe('routes/me — bypassed-RLS regression (H4)', () => {
  it('returns user=null when a caller in org A targets a user row that belongs to org B', async () => {
    const USER_B = '00000000-0000-0000-0000-00000000bbaa';
    const trx = makeMockDb({
      users: [
        {
          id: USER_B,
          org_id: ORG_B,
          email: 'b@b.com',
          clerk_user_id: 'clerk_b',
          role: 'member',
          default_rate_cents: null,
          is_admin: false,
          easter_egg_enabled: false,
        },
      ],
    });

    // Caller is authenticated as USER_B (userId echoes the row) but authorized
    // under ORG_A. Under bypassed RLS, `.where({ id })` would find the row; the
    // H4 fix adds `org_id: ORG_A` which makes the lookup miss.
    const result = (await runWithTenantContext({ orgId: ORG_A, trx }, () =>
      handleMe(fakeReq({ userId: USER_B, orgId: ORG_A }))
    )) as { data: { user: Row | null; org: Row } };

    expect(result.data.user).to.equal(null);
    expect(result.data.org).to.deep.include({ id: ORG_A });
  });
});

describe('routes/clients — list bypassed-RLS regression (H4)', () => {
  it('returns only the caller\'s org rows when RLS is bypassed', async () => {
    const ID_A = '00000000-0000-0000-0000-000000000aa1';
    const trx = makeMockDb({
      clients: [
        {
          id: ID_A,
          org_id: ORG_A,
          name: 'A Client',
          email: null,
          billing_address: null,
          notes: null,
          default_rate_cents: null,
          ar_automation_enabled: null,
          ar_approval_required: null,
          ar_reminders_enabled: null,
          ar_reminder_cadence_days: null,
          seeded_at: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
        {
          id: ID_B,
          org_id: ORG_B,
          name: 'B Client',
          email: null,
          billing_address: null,
          notes: null,
          default_rate_cents: null,
          ar_automation_enabled: null,
          ar_approval_required: null,
          ar_reminders_enabled: null,
          ar_reminder_cadence_days: null,
          seeded_at: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
      ],
    });

    const result = (await runWithTenantContext({ orgId: ORG_A, trx }, () =>
      handleClientList(fakeReq({ userId: 'user_a', orgId: ORG_A }))
    )) as { data: Array<{ id: string; org_id?: string }> };

    expect(result.data).to.have.length(1);
    expect(result.data[0].id).to.equal(ID_A);
  });
});

describe('routes/clients/:id — bypassed-RLS regression (H4)', () => {
  it('returns 404 when a caller in org A requests org B\'s client id', async () => {
    const trx = makeMockDb({
      clients: [
        {
          id: ID_B,
          org_id: ORG_B,
          name: 'Org B Client',
          email: null,
          billing_address: null,
          notes: null,
          default_rate_cents: null,
          ar_automation_enabled: null,
          ar_approval_required: null,
          ar_reminders_enabled: null,
          ar_reminder_cadence_days: null,
          seeded_at: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
      ],
    });

    let caught: unknown;
    try {
      await runWithTenantContext({ orgId: ORG_A, trx }, () =>
        handleClientGet(fakeReq({ userId: 'user_a', orgId: ORG_A, params: { id: ID_B } }))
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });
});

describe('routes/invoices/:id — bypassed-RLS regression (H4)', () => {
  it('returns 404 when a caller in org A requests org B\'s invoice id', async () => {
    const trx = makeMockDb({
      invoices: [
        {
          id: ID_B,
          org_id: ORG_B,
          client_id: '00000000-0000-0000-0000-000000000bc1',
          number: '2026-0001',
          status: 'open',
          issue_date: '2026-04-18',
          due_date: null,
          subtotal_cents: 10000,
          total_cents: 10000,
          notes: null,
          stripe_payment_intent_id: 'pi_x',
          stripe_client_secret: 'pi_x_secret_y',
          paid_at: null,
          payment_token: 'tok_x',
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
          seeded_at: null,
          reminders_sent_count: 0,
          auto_generated_at: null,
          approved_at: null,
          sent_at: null,
        },
      ],
      invoice_line_items: [],
      clients: [],
      platforms: [],
    });

    let caught: unknown;
    try {
      await runWithTenantContext({ orgId: ORG_A, trx }, () =>
        handleInvoiceGet(ID_B, ORG_A, trx)
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });

  it('returns the invoice when the caller is in the owning org (positive control)', async () => {
    const INV = '00000000-0000-0000-0000-000000000aa1';
    const CLIENT = '00000000-0000-0000-0000-000000000aa2';
    const trx = makeMockDb({
      invoices: [
        {
          id: INV,
          org_id: ORG_A,
          client_id: CLIENT,
          number: '2026-0001',
          status: 'open',
          issue_date: '2026-04-18',
          due_date: null,
          subtotal_cents: 10000,
          total_cents: 10000,
          notes: null,
          stripe_payment_intent_id: 'pi_x',
          stripe_client_secret: 'pi_x_secret_y',
          paid_at: null,
          payment_token: 'tok_x',
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
          seeded_at: null,
          reminders_sent_count: 0,
          auto_generated_at: null,
          approved_at: null,
          sent_at: null,
        },
      ],
      invoice_line_items: [],
      clients: [
        {
          id: CLIENT,
          org_id: ORG_A,
          name: 'A Client',
          email: 'c@a.com',
        },
      ],
      platforms: [],
    });

    const result = (await runWithTenantContext({ orgId: ORG_A, trx }, () =>
      handleInvoiceGet(INV, ORG_A, trx)
    )) as { data: { id: string } };
    expect(result.data.id).to.equal(INV);
  });
});

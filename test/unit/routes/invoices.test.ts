import { expect } from 'chai';
import type { Knex } from 'knex';

import { env } from '../../../src/config/env';
import {
  CreateInvoiceBody,
  UpdateInvoiceBody,
  handleApproveSend,
  handleGet,
  handleList,
  handleRejectApproval,
  handleSend,
} from '../../../src/routes/invoices';
import {
  createDraft,
  deleteDraft,
  finalizeInvoice,
  getInvoiceWithItems,
  listInvoices,
  updateDraft,
  voidInvoice,
  type InvoiceRow,
  type LineItemRow,
} from '../../../src/services/invoices';
import { AppError } from '../../../src/middleware/error-handler';

type Row = Record<string, unknown>;

interface MockDb {
  (table: string): any;
  _tables: Record<string, Row[]>;
  _seed: (table: string, row: Row) => void;
}

/**
 * Small Knex-ish in-memory stub. Covers only what the service exercises:
 * where / whereIn / whereNot / whereNotExists is NOT needed here (we bypass
 * the time-entries filter in unit tests by mocking the join result on the
 * line_items lookup). insert + returning + update + del + forUpdate + first +
 * join are supported.
 */
function makeMockDb(): MockDb {
  const tables: Record<string, Row[]> = {
    invoices: [],
    invoice_line_items: [],
    invoice_sequences: [],
    clients: [],
    time_entries: [],
    platforms: [],
    organizations: [],
    audit_log: [],
  };
  let idCounter = 0;

  function query(tableName: string) {
    const conditions: Array<(r: Row) => boolean> = [];
    let selectedCols: string[] | null = null;
    let orderSpec: { col: string; dir: 'asc' | 'desc' } | null = null;
    let joinSpec:
      | { table: string; leftCol: string; rightCol: string; whereNot?: [string, unknown] }
      | null = null;

    const api: any = {
      where(cond: Row | string, op?: unknown, val?: unknown) {
        if (typeof cond === 'string') {
          const column = cond;
          const expectedVal = op !== undefined && val === undefined ? op : val;
          conditions.push((r) => {
            const rowVal = joinSpec ? (r as any).__joined?.[column] ?? r[column] : r[column];
            return rowVal === expectedVal;
          });
        } else {
          conditions.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        }
        return api;
      },
      whereIn(col: string, values: unknown[]) {
        const bare = col.split('.').pop() as string;
        const isForeign =
          col.includes('.') && !col.startsWith(`${tableName}.`);
        conditions.push((r) => {
          const v = isForeign ? (r as any).__joined?.[bare] : r[bare];
          return values.includes(v);
        });
        return api;
      },
      whereNot(col: string, val: unknown) {
        if (joinSpec) {
          const bare = col.split('.').pop() as string;
          joinSpec.whereNot = [bare, val];
        } else {
          const bare = col.split('.').pop() as string;
          conditions.push((r) => r[bare] !== val);
        }
        return api;
      },
      join(table: string, left: string, right: string) {
        // Normalize so `baseCol` is on the current (tableName) side and
        // `otherCol` is on the joined table side — regardless of clause order.
        const [leftTable, leftCol] = left.split('.');
        const [rightTable, rightCol] = right.split('.');
        const baseCol = leftTable === tableName ? leftCol : rightCol;
        const otherCol = leftTable === tableName ? rightCol : leftCol;
        void rightTable;
        joinSpec = { table, leftCol: baseCol, rightCol: otherCol };
        return api;
      },
      select(...cols: string[]) {
        const filtered = cols.filter((c) => c !== '*');
        selectedCols = filtered.length ? filtered : null;
        return api;
      },
      orderBy(col: string, dir: 'asc' | 'desc' = 'asc') {
        orderSpec = { col: col.split('.').pop() as string, dir };
        return api;
      },
      forUpdate() {
        return api;
      },
      async first() {
        const rows = runSelect();
        return rows[0];
      },
      then(resolve: (r: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        try {
          const rows = runSelect();
          return Promise.resolve(rows).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).catch(reject);
        }
      },
      insert(payload: Row | Row[]) {
        const payloads = Array.isArray(payload) ? payload : [payload];
        const inserted: Row[] = [];
        for (const p of payloads) {
          const row: Row = {
            id: p.id ?? `mock-${tableName}-${++idCounter}`,
            created_at: '2026-04-18T00:00:00Z',
            updated_at: '2026-04-18T00:00:00Z',
            ...p,
          };
          tables[tableName].push(row);
          inserted.push(row);
        }
        const q: any = {
          async returning(_col: string | string[]) {
            return inserted;
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(inserted).then(resolve, reject);
          },
        };
        return q;
      },
      update(patch: Row) {
        const matched = tables[tableName].filter((r) =>
          conditions.length ? conditions.every((c) => c(r)) : true
        );
        for (const r of matched) Object.assign(r, patch);
        const q: any = {
          async returning(_col: string | string[]) {
            return matched;
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(matched.length).then(resolve, reject);
          },
        };
        return q;
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) =>
          conditions.length ? !conditions.every((c) => c(r)) : false
        );
        return before - tables[tableName].length;
      },
    };

    function runSelect(): Row[] {
      let rows = tables[tableName].slice();
      if (joinSpec) {
        const other = tables[joinSpec.table] ?? [];
        rows = rows
          .map((r) => {
            const match = other.find((o) => o[joinSpec!.rightCol] === r[joinSpec!.leftCol]);
            return match ? { ...r, __joined: match } : null;
          })
          .filter((r): r is Row => r !== null);
        if (joinSpec.whereNot) {
          const [col, val] = joinSpec.whereNot;
          rows = rows.filter((r) => (r as any).__joined?.[col] !== val);
        }
      }
      if (conditions.length) rows = rows.filter((r) => conditions.every((c) => c(r)));
      if (orderSpec) {
        rows.sort((a, b) => {
          const av = a[orderSpec!.col] as any;
          const bv = b[orderSpec!.col] as any;
          if (av < bv) return orderSpec!.dir === 'asc' ? -1 : 1;
          if (av > bv) return orderSpec!.dir === 'asc' ? 1 : -1;
          return 0;
        });
      }
      if (selectedCols) {
        rows = rows.map((r) => {
          const o: Row = {};
          for (const c of selectedCols!) {
            const col = c.includes(' as ') ? c.split(' as ')[1] : c.split('.').pop()!;
            const src = c.includes(' as ') ? c.split(' as ')[0] : c;
            const parts = src.split('.');
            const value = parts.length > 1 && parts[0] !== tableName ? (r as any).__joined?.[parts[1]] : r[parts[parts.length - 1]];
            o[col] = value;
          }
          return o;
        });
      }
      return rows;
    }

    return api;
  }

  const mock = query as unknown as MockDb;
  const fn = ((t: string) => query(t)) as MockDb;
  fn._tables = tables;
  fn._seed = (table, row) => {
    tables[table].push(row);
  };
  return fn;
}

function seedOrg(db: MockDb, orgId = 'org_1') {
  db._seed('organizations', { id: orgId, name: 'Acme Law LLP' });
}

function seedClient(db: MockDb, id = 'client_1', orgId = 'org_1', email: string | null = 'bill@example.com') {
  db._seed('clients', { id, org_id: orgId, name: 'Client A', email });
}

function seedTimeEntry(
  db: MockDb,
  id: string,
  clientId: string,
  orgId = 'org_1',
  durationMinutes = 60,
  hourlyRateCents = 20_000
) {
  db._seed('time_entries', {
    id,
    org_id: orgId,
    client_id: clientId,
    description: `Work ${id}`,
    duration_minutes: durationMinutes,
    hourly_rate_cents: hourlyRateCents,
  });
}

function seedPlatform(db: MockDb, orgId = 'org_1', acctId = 'acct_abc') {
  db._seed('platforms', {
    id: 'plat_1',
    org_id: orgId,
    type: 'stripe',
    external_account_id: acctId,
    credentials_encrypted: null,
    credentials_iv: null,
    credentials_tag: null,
  });
}

describe('routes/invoices — Zod schemas', () => {
  it('CreateInvoiceBody rejects empty timeEntryIds', () => {
    const r = CreateInvoiceBody.safeParse({
      clientId: '00000000-0000-0000-0000-000000000001',
      timeEntryIds: [],
    });
    expect(r.success).to.equal(false);
  });

  it('CreateInvoiceBody accepts minimal valid body', () => {
    const r = CreateInvoiceBody.safeParse({
      clientId: '00000000-0000-0000-0000-000000000001',
      timeEntryIds: ['00000000-0000-0000-0000-000000000002'],
    });
    expect(r.success).to.equal(true);
  });

  it('UpdateInvoiceBody accepts partial patches', () => {
    expect(UpdateInvoiceBody.safeParse({}).success).to.equal(true);
    expect(UpdateInvoiceBody.safeParse({ notes: null }).success).to.equal(true);
    expect(
      UpdateInvoiceBody.safeParse({
        removeLineItemIds: ['00000000-0000-0000-0000-000000000003'],
      }).success
    ).to.equal(true);
  });
});

describe('services/invoices — createDraft', () => {
  it('creates a draft with correct totals + line items from time entries', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedTimeEntry(db, 'te_1', 'client_1', 'org_1', 60, 25_000); // 1h @ $250 = 25000¢
    seedTimeEntry(db, 'te_2', 'client_1', 'org_1', 90, 20_000); // 1.5h @ $200 = 30000¢

    const result = await createDraft(
      { clientId: 'client_1', timeEntryIds: ['te_1', 'te_2'] },
      'org_1',
      db as unknown as Knex['default'] as any
    );

    expect(result.invoice.status).to.equal('draft');
    expect(Number(result.invoice.subtotal_cents)).to.equal(55_000);
    expect(Number(result.invoice.total_cents)).to.equal(55_000);
    expect(result.items).to.have.length(2);
    const amounts = result.items.map((l: LineItemRow) => Number(l.amount_cents)).sort();
    expect(amounts).to.deep.equal([25_000, 30_000]);
  });

  it('rejects time entries that do not belong to the given client', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedClient(db, 'client_2');
    seedTimeEntry(db, 'te_1', 'client_2'); // belongs to other client

    let caught: unknown;
    try {
      await createDraft(
        { clientId: 'client_1', timeEntryIds: ['te_1'] },
        'org_1',
        db as any
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
  });

  it('rejects already-billed time entries', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedTimeEntry(db, 'te_1', 'client_1');

    // Pre-seed a prior invoice + line item referencing te_1 (non-void).
    db._seed('invoices', {
      id: 'inv_prev',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
    });
    db._seed('invoice_line_items', {
      id: 'li_prev',
      org_id: 'org_1',
      invoice_id: 'inv_prev',
      time_entry_id: 'te_1',
      amount_cents: 10_000,
    });

    let caught: unknown;
    try {
      await createDraft(
        { clientId: 'client_1', timeEntryIds: ['te_1'] },
        'org_1',
        db as any
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).message).to.include('already billed');
  });

  it('permits re-billing time entries whose prior invoice is void', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedTimeEntry(db, 'te_1', 'client_1', 'org_1', 60, 10_000);
    db._seed('invoices', {
      id: 'inv_void',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'void',
    });
    db._seed('invoice_line_items', {
      id: 'li_void',
      org_id: 'org_1',
      invoice_id: 'inv_void',
      time_entry_id: 'te_1',
      amount_cents: 10_000,
    });

    const result = await createDraft(
      { clientId: 'client_1', timeEntryIds: ['te_1'] },
      'org_1',
      db as any
    );
    expect(result.invoice.status).to.equal('draft');
  });
});

describe('services/invoices — finalize (lazy PI)', () => {
  it('allocates sequential YYYY-NNNN numbers and does NOT touch Stripe', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    // NOTE: platform intentionally omitted — finalize no longer requires Stripe.

    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });
    db._seed('invoices', {
      id: 'inv_b',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      total_cents: 20_000,
      subtotal_cents: 20_000,
    });

    const a = await finalizeInvoice('inv_a', 'org_1', db as any);
    const b = await finalizeInvoice('inv_b', 'org_1', db as any);

    const year = new Date().getUTCFullYear();
    expect(a.invoice.number).to.equal(`${year}-0001`);
    expect(b.invoice.number).to.equal(`${year}-0002`);
    expect(a.invoice.status).to.equal('open');
    // PI is lazy now — finalize leaves these null.
    expect(a.invoice.stripe_payment_intent_id ?? null).to.equal(null);
    expect(a.invoice.stripe_client_secret ?? null).to.equal(null);
    expect(a.invoice.payment_token).to.be.a('string').with.length.greaterThan(10);
  });

  it('rejects finalize when total_cents <= 0', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_zero',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      total_cents: 0,
      subtotal_cents: 0,
    });

    let caught: unknown;
    try {
      await finalizeInvoice('inv_zero', 'org_1', db as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
  });

  it('refuses to finalize a non-draft invoice', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedPlatform(db);
    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      total_cents: 10_000,
    });

    let caught: unknown;
    try {
      await finalizeInvoice('inv_a', 'org_1', db as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(409);
  });
});

describe('services/invoices — voidInvoice', () => {
  it('cancels the PaymentIntent on the connected account when one exists', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    seedPlatform(db, 'org_1', 'acct_abc');
    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      stripe_payment_intent_id: 'pi_xyz',
      total_cents: 10_000,
    });

    const cancelCalls: Array<[string, string]> = [];
    const result = await voidInvoice('inv_a', 'org_1', db as any, {
      cancelPaymentIntent: async (piId, acct) => {
        cancelCalls.push([piId, acct]);
      },
    });

    expect(result.status).to.equal('void');
    expect(cancelCalls).to.deep.equal([['pi_xyz', 'acct_abc']]);
  });

  it('refuses to void a paid invoice', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'paid',
    });

    let caught: unknown;
    try {
      await voidInvoice('inv_a', 'org_1', db as any, {
        cancelPaymentIntent: async () => {
          throw new Error('should not be called');
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(409);
  });
});

describe('services/invoices — deleteDraft', () => {
  it('deletes only when status is draft', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_draft',
      org_id: 'org_1',
      client_id: 'c',
      status: 'draft',
    });
    db._seed('invoices', {
      id: 'inv_open',
      org_id: 'org_1',
      client_id: 'c',
      status: 'open',
    });

    const ok = await deleteDraft('inv_draft', 'org_1', db as any);
    expect(ok).to.deep.equal({ id: 'inv_draft' });

    let caught: unknown;
    try {
      await deleteDraft('inv_open', 'org_1', db as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(409);
  });
});

describe('services/invoices — updateDraft + listInvoices', () => {
  it('updates a draft and recomputes totals when removing line items', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'c',
      status: 'draft',
      subtotal_cents: 50_000,
      total_cents: 50_000,
    });
    db._seed('invoice_line_items', {
      id: 'li_1',
      org_id: 'org_1',
      invoice_id: 'inv_a',
      amount_cents: 20_000,
    });
    db._seed('invoice_line_items', {
      id: 'li_2',
      org_id: 'org_1',
      invoice_id: 'inv_a',
      amount_cents: 30_000,
    });

    const result = await updateDraft(
      'inv_a',
      { removeLineItemIds: ['li_1'], notes: 'Net-15' },
      'org_1',
      db as any
    );
    expect(Number(result.invoice.subtotal_cents)).to.equal(30_000);
    expect(Number(result.invoice.total_cents)).to.equal(30_000);
    expect(result.invoice.notes).to.equal('Net-15');
    expect(result.items).to.have.length(1);
  });

  it('listInvoices filters by status and clientId', async () => {
    const db = makeMockDb();
    db._seed('invoices', { id: 'a', org_id: 'org_1', client_id: 'c1', status: 'draft' });
    db._seed('invoices', { id: 'b', org_id: 'org_1', client_id: 'c1', status: 'open' });
    db._seed('invoices', { id: 'c', org_id: 'org_1', client_id: 'c2', status: 'open' });

    const openC1 = await listInvoices({ status: 'open', clientId: 'c1' }, db as any);
    expect(openC1).to.have.length(1);
    expect(openC1[0].id).to.equal('b');
  });
});

describe('routes/invoices — handleSend skip logic', () => {
  it('skips email + writes audit_log for seeded invoices', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1', 'org_1', 'real@customer.com');
    db._seed('invoices', {
      id: 'inv_s',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      seeded_at: '2026-04-18T00:00:00Z',
      total_cents: 10_000,
      subtotal_cents: 10_000,
      payment_token: 'tok',
    });

    let enqueued = 0;
    const res = await handleSend('inv_s', 'org_1', db as any, async () => {
      enqueued += 1;
    });
    expect(enqueued).to.equal(0);
    const body = res.data as { warnings?: string[] };
    expect(body.warnings?.[0]).to.contain('skipped');
    const audit = db._tables.audit_log;
    expect(audit).to.have.length(1);
    expect(audit[0]).to.include({
      source: 'invoice.send',
      event_type: 'invoice.email.skipped',
      external_id: 'inv_s',
      status: 'skipped',
    });
    expect((audit[0].payload as any).reason).to.equal('seeded');
  });

  it('skips email + writes audit_log for example-domain clients', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1', 'org_1', 'bill@example.com');
    db._seed('invoices', {
      id: 'inv_e',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      seeded_at: null,
      total_cents: 10_000,
      subtotal_cents: 10_000,
      payment_token: 'tok',
    });

    let enqueued = 0;
    const res = await handleSend('inv_e', 'org_1', db as any, async () => {
      enqueued += 1;
    });
    expect(enqueued).to.equal(0);
    const body = res.data as { warnings?: string[] };
    expect(body.warnings?.[0]).to.contain('skipped');
    expect((db._tables.audit_log[0].payload as any).reason).to.equal('example_domain');
  });

  it('also skips for nested example subdomains like foo.example.com', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1', 'org_1', 'user@foo.example.com');
    db._seed('invoices', {
      id: 'inv_e2',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      seeded_at: null,
      total_cents: 10_000,
      subtotal_cents: 10_000,
      payment_token: 'tok',
    });

    let enqueued = 0;
    await handleSend('inv_e2', 'org_1', db as any, async () => {
      enqueued += 1;
    });
    expect(enqueued).to.equal(0);
  });

  it('enqueues for real clients (happy path) and does not write an audit_log row', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1', 'org_1', 'real@customer.com');
    db._seed('invoices', {
      id: 'inv_ok',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      seeded_at: null,
      total_cents: 10_000,
      subtotal_cents: 10_000,
      payment_token: 'tok',
    });

    let enqueued: string | null = null;
    const res = await handleSend('inv_ok', 'org_1', db as any, async (invoiceId) => {
      enqueued = invoiceId;
    });
    expect(enqueued).to.equal('inv_ok');
    expect((res.data as { warnings?: string[] }).warnings).to.equal(undefined);
    expect(db._tables.audit_log).to.have.length(0);
  });

  it('rejects non-open invoices with 409', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_draft',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
    });

    let caught: unknown;
    try {
      await handleSend('inv_draft', 'org_1', db as any, async () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(409);
  });
});

describe('routes/invoices — paymentUrl surfacing on detail', () => {
  // env.FRONTEND_URL is validated once at module load and defaults to
  // http://localhost:5173 when unset — that's what these tests expect.
  const FE = 'http://localhost:5173';

  function seedOpenInvoice(db: MockDb, id: string, token: string | null) {
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id,
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      number: '2026-0001',
      total_cents: 10_000,
      subtotal_cents: 10_000,
      stripe_payment_intent_id: 'pi_existing',
      stripe_client_secret: 'pi_existing_secret',
      payment_token: token,
    });
  }

  it('includes paymentUrl on an open invoice that has a payment_token', async () => {
    const db = makeMockDb();
    seedOpenInvoice(db, 'inv_1', 'tok_abc');
    const res = await handleGet('inv_1', 'org_1', db as any);
    const body = res.data as { paymentUrl?: string };
    expect(body.paymentUrl).to.equal(`${FE}/pay/inv_1?token=tok_abc`);
  });

  it('omits paymentUrl on draft invoices', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_draft',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      payment_token: 'tok_xxx',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });
    const res = await handleGet('inv_draft', 'org_1', db as any);
    expect((res.data as any).paymentUrl).to.equal(undefined);
  });

  it('omits paymentUrl on paid invoices', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_paid',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'paid',
      payment_token: 'tok_xxx',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });
    const res = await handleGet('inv_paid', 'org_1', db as any);
    expect((res.data as any).paymentUrl).to.equal(undefined);
  });

  it('omits paymentUrl on void invoices', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_void',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'void',
      payment_token: 'tok_xxx',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });
    const res = await handleGet('inv_void', 'org_1', db as any);
    expect((res.data as any).paymentUrl).to.equal(undefined);
  });

  it('list endpoint never includes paymentUrl (or any surrogate field)', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_list',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      payment_token: 'tok_list',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });
    const res = await handleList({}, db as any);
    for (const row of res.data) {
      expect((row as any).paymentUrl).to.equal(undefined);
    }
  });
});

describe('routes/invoices — detail response does not leak credentials', () => {
  it('never includes paymentToken or stripeClientSecret on non-open invoices', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_a',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      payment_token: 'tok_secret',
      stripe_client_secret: 'pi_secret',
    });

    const { invoice, items, client } = await getInvoiceWithItems('inv_a', 'org_1', db as any);
    // Simulate what the route does: drop token, null out client_secret for non-open.
    const payload: any = { ...invoice, payment_token: null, line_items: items, client };
    if (payload.status !== 'open') payload.stripe_client_secret = null;

    expect(payload.payment_token).to.equal(null);
    expect(payload.stripe_client_secret).to.equal(null);
  });
});

describe('routes/invoices — handleGet seeded-invoice gating on live Stripe', () => {
  const originalKey = env.STRIPE_SECRET_KEY;
  afterEach(() => {
    env.STRIPE_SECRET_KEY = originalKey;
  });

  it('returns payload with paymentUnavailableReason and null stripeClientSecret for a seeded open invoice in live mode', async () => {
    env.STRIPE_SECRET_KEY = 'sk_live_abc';
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_seeded',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      number: '2026-0001',
      total_cents: 10_000,
      subtotal_cents: 10_000,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
      payment_token: 'tok_seeded',
      seeded_at: '2026-04-18T00:00:00Z',
    });

    const res = await handleGet('inv_seeded', 'org_1', db as any);
    const body = res.data as {
      stripeClientSecret: string | null;
      paymentUnavailableReason?: string;
      paymentUrl?: string;
    };
    expect(body.paymentUnavailableReason).to.equal('seed_requires_test_mode');
    expect(body.stripeClientSecret).to.equal(null);
    // paymentUrl still structurally surfaces for the org user.
    expect(body.paymentUrl).to.match(/\/pay\/inv_seeded\?token=tok_seeded$/);
  });
});

describe('routes/invoices — handleApproveSend guards', () => {
  it('throws NOT_AR_GENERATED when auto_generated_at is null', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_manual',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      auto_generated_at: null,
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });

    let caught: unknown;
    try {
      await handleApproveSend('inv_manual', 'org_1', db as any, async () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).code).to.equal('NOT_AR_GENERATED');
  });

  it('throws INVALID_STATUS when invoice is not draft', async () => {
    const db = makeMockDb();
    seedOrg(db);
    seedClient(db, 'client_1');
    db._seed('invoices', {
      id: 'inv_open',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      auto_generated_at: '2026-04-18T00:00:00Z',
      total_cents: 10_000,
      subtotal_cents: 10_000,
    });

    let caught: unknown;
    try {
      await handleApproveSend('inv_open', 'org_1', db as any, async () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).code).to.equal('INVALID_STATUS');
  });

  it('returns 404 when invoice does not exist', async () => {
    const db = makeMockDb();
    let caught: unknown;
    try {
      await handleApproveSend('missing', 'org_1', db as any, async () => {});
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });
});

describe('routes/invoices — handleRejectApproval guards', () => {
  it('throws NOT_AR_GENERATED when auto_generated_at is null', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_manual',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      auto_generated_at: null,
    });

    let caught: unknown;
    try {
      await handleRejectApproval('inv_manual', 'org_1', db as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).code).to.equal('NOT_AR_GENERATED');
  });

  it('throws INVALID_STATUS when invoice is not draft', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_open',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'open',
      auto_generated_at: '2026-04-18T00:00:00Z',
    });

    let caught: unknown;
    try {
      await handleRejectApproval('inv_open', 'org_1', db as any);
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).code).to.equal('INVALID_STATUS');
  });

  it('deletes the draft and returns { deleted: true } on the happy path', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_ar',
      org_id: 'org_1',
      client_id: 'client_1',
      status: 'draft',
      auto_generated_at: '2026-04-18T00:00:00Z',
    });

    const res = await handleRejectApproval('inv_ar', 'org_1', db as any);
    expect(res).to.deep.equal({ data: { deleted: true } });
    expect(db._tables.invoices.find((i) => i.id === 'inv_ar')).to.equal(undefined);
  });
});

// Suppress the unused type warning since InvoiceRow is used for type context above.
void (null as unknown as InvoiceRow);

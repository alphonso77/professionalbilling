import { expect } from 'chai';

import { hasSeededData, removeSeeded, run } from '../../../src/services/seed-builder';

type Row = Record<string, unknown>;

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    invoices: [],
    invoice_line_items: [],
    invoice_sequences: [],
    clients: [],
    time_entries: [],
  };
  let idCounter = 0;

  function query(tableName: string) {
    const conds: Array<(r: Row) => boolean> = [];
    const nonNullCols: string[] = [];
    let cols: string[] | null = null;

    const api: any = {
      where(cond: Record<string, unknown>) {
        conds.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        return api;
      },
      whereNotNull(col: string) {
        nonNullCols.push(col);
        conds.push((r) => r[col] !== null && r[col] !== undefined);
        return api;
      },
      select(...c: string[]) {
        cols = c.filter((x) => x !== '*');
        if (!cols.length) cols = null;
        return api;
      },
      forUpdate() {
        return api;
      },
      async first() {
        const match = tables[tableName].find((r) => conds.every((f) => f(r)));
        if (!match) return undefined;
        if (!cols) return match;
        const o: Row = {};
        for (const c of cols) o[c] = match[c];
        return o;
      },
      insert(payload: Row | Row[]) {
        const payloads = Array.isArray(payload) ? payload : [payload];
        const inserted: Row[] = [];
        for (const p of payloads) {
          const row: Row = {
            id: p.id ?? `mock-${tableName}-${++idCounter}`,
            ...p,
          };
          tables[tableName].push(row);
          inserted.push(row);
        }
        const q: any = {
          async returning(c: string | string[]) {
            const picks = Array.isArray(c) ? c : [c];
            return inserted.map((row) => {
              const o: Row = {};
              for (const k of picks) o[k] = row[k];
              return o;
            });
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(inserted).then(resolve, reject);
          },
        };
        return q;
      },
      update(patch: Row) {
        const matched = tables[tableName].filter((r) => conds.every((f) => f(r)));
        for (const r of matched) Object.assign(r, patch);
        return Promise.resolve(matched.length);
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) => !conds.every((f) => f(r)));
        return before - tables[tableName].length;
      },
    };
    return api;
  }

  const fn: any = (t: string) => query(t);
  fn._tables = tables;
  return fn;
}

describe('services/seed-builder', () => {
  it('inserts clients, time entries, and open invoices — all with seeded_at set, no Stripe fields', async () => {
    const db = makeMockDb();
    const summary = await run('org_1', db as any);

    expect(summary.clients).to.equal(4);
    expect(summary.time_entries).to.be.greaterThan(0);
    expect(summary.invoices).to.equal(3); // 3 of 4 specs are billed

    for (const c of db._tables.clients) {
      expect(c.seeded_at).to.be.a('string');
      expect(c.org_id).to.equal('org_1');
    }
    for (const e of db._tables.time_entries) {
      expect(e.seeded_at).to.be.a('string');
      expect(e.hourly_rate_cents).to.be.a('number');
    }
    for (const inv of db._tables.invoices) {
      expect(inv.seeded_at).to.be.a('string');
      expect(inv.status).to.equal('open');
      expect(inv.number).to.match(/^\d{4}-\d{4}$/);
      expect(inv.payment_token).to.be.a('string');
      expect(inv.stripe_payment_intent_id ?? null).to.equal(null);
      expect(inv.stripe_client_secret ?? null).to.equal(null);
    }
  });

  it('hasSeededData is false before seed and true after', async () => {
    const db = makeMockDb();
    expect(await hasSeededData('org_1', db as any)).to.equal(false);
    await run('org_1', db as any);
    expect(await hasSeededData('org_1', db as any)).to.equal(true);
  });

  it('removeSeeded deletes every seeded row but preserves user rows', async () => {
    const db = makeMockDb();
    // Pre-seed a real (non-seeded) client + entry.
    db._tables.clients.push({ id: 'real-client', org_id: 'org_1', name: 'Real', seeded_at: null });
    db._tables.time_entries.push({
      id: 'real-entry',
      org_id: 'org_1',
      client_id: 'real-client',
      description: 'real',
      duration_minutes: 60,
      hourly_rate_cents: 20_000,
      seeded_at: null,
    });

    await run('org_1', db as any);
    const counts = await removeSeeded('org_1', db as any);
    expect(counts.clients).to.equal(4);
    expect(counts.invoices).to.equal(3);
    expect(counts.time_entries).to.be.greaterThan(0);

    // Real data untouched.
    expect(db._tables.clients.map((r) => r.id)).to.include('real-client');
    expect(db._tables.time_entries.map((r) => r.id)).to.include('real-entry');
  });
});

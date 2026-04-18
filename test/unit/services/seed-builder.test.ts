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
    let distinctMode = false;

    const materialize = (): Row[] => {
      const matched = tables[tableName].filter((r) => conds.every((f) => f(r)));
      let result: Row[];
      if (cols) {
        result = matched.map((row) => {
          const o: Row = {};
          for (const c of cols!) o[c] = row[c];
          return o;
        });
      } else {
        result = matched.slice();
      }
      if (distinctMode && cols) {
        const seen = new Set<string>();
        result = result.filter((r) => {
          const key = JSON.stringify(cols!.map((c) => r[c]));
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return result;
    };

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
      whereIn(col: string, values: unknown[]) {
        conds.push((r) => values.includes(r[col]));
        return api;
      },
      select(...c: string[]) {
        cols = c.filter((x) => x !== '*');
        if (!cols.length) cols = null;
        return api;
      },
      distinct(...c: string[]) {
        cols = c;
        distinctMode = true;
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
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(materialize()).then(resolve, reject);
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
    expect(counts.adopted).to.equal(0);

    // Real data untouched.
    expect(db._tables.clients.map((r) => r.id)).to.include('real-client');
    expect(db._tables.time_entries.map((r) => r.id)).to.include('real-entry');
  });

  it('removeSeeded adopts a seeded client that has a non-seeded invoice pointing at it', async () => {
    const db = makeMockDb();
    await run('org_1', db as any);
    const target = db._tables.clients.find((c) => c.name === 'Acme Corp') as Row;
    expect(target).to.not.be.undefined;

    db._tables.invoices.push({
      id: 'real-invoice',
      org_id: 'org_1',
      client_id: target.id,
      status: 'open',
      total_cents: 10_000,
      seeded_at: null,
    });

    const counts = await removeSeeded('org_1', db as any);
    expect(counts.adopted).to.equal(1);
    expect(counts.clients).to.equal(3);

    const still = db._tables.clients.find((c) => c.id === target.id) as Row;
    expect(still, 'adopted client still exists').to.not.be.undefined;
    expect(still.seeded_at).to.equal(null);

    const inv = db._tables.invoices.find((i) => i.id === 'real-invoice') as Row;
    expect(inv, 'non-seeded invoice preserved').to.not.be.undefined;
    expect(inv.client_id).to.equal(target.id);
  });

  it('removeSeeded adopts a seeded client that has a non-seeded time_entry pointing at it', async () => {
    const db = makeMockDb();
    await run('org_1', db as any);
    const target = db._tables.clients.find((c) => c.name === 'Globex Industries') as Row;
    expect(target).to.not.be.undefined;

    db._tables.time_entries.push({
      id: 'real-entry',
      org_id: 'org_1',
      client_id: target.id,
      description: 'real work',
      duration_minutes: 30,
      hourly_rate_cents: 25_000,
      seeded_at: null,
    });

    const counts = await removeSeeded('org_1', db as any);
    expect(counts.adopted).to.equal(1);
    expect(counts.clients).to.equal(3);

    const still = db._tables.clients.find((c) => c.id === target.id) as Row;
    expect(still).to.not.be.undefined;
    expect(still.seeded_at).to.equal(null);

    const te = db._tables.time_entries.find((t) => t.id === 'real-entry') as Row;
    expect(te).to.not.be.undefined;
    expect(te.client_id).to.equal(target.id);
  });

  it('removeSeeded deletes fully-orphan seeded clients', async () => {
    const db = makeMockDb();
    await run('org_1', db as any);

    const counts = await removeSeeded('org_1', db as any);
    expect(counts.adopted).to.equal(0);
    expect(counts.clients).to.equal(4);

    const remaining = db._tables.clients.filter((c) => c.org_id === 'org_1');
    expect(remaining.length).to.equal(0);
  });

  it('removeSeeded handles mixed adoption (one adopted, others deleted)', async () => {
    const db = makeMockDb();
    await run('org_1', db as any);
    const acme = db._tables.clients.find((c) => c.name === 'Acme Corp') as Row;
    const globex = db._tables.clients.find((c) => c.name === 'Globex Industries') as Row;

    db._tables.invoices.push({
      id: 'real-invoice',
      org_id: 'org_1',
      client_id: acme.id,
      status: 'open',
      total_cents: 5_000,
      seeded_at: null,
    });
    db._tables.time_entries.push({
      id: 'real-entry',
      org_id: 'org_1',
      client_id: globex.id,
      description: 'real',
      duration_minutes: 15,
      hourly_rate_cents: 20_000,
      seeded_at: null,
    });

    const counts = await removeSeeded('org_1', db as any);
    expect(counts.adopted).to.equal(2);
    expect(counts.clients).to.equal(2);

    const acmeAfter = db._tables.clients.find((c) => c.id === acme.id) as Row;
    const globexAfter = db._tables.clients.find((c) => c.id === globex.id) as Row;
    expect(acmeAfter.seeded_at).to.equal(null);
    expect(globexAfter.seeded_at).to.equal(null);
  });
});

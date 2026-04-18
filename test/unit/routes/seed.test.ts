import { expect } from 'chai';

import { handleRemoveSeed, handleReseed, handleSeed } from '../../../src/routes/seed';

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
          const row: Row = { id: p.id ?? `mock-${tableName}-${++idCounter}`, ...p };
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

describe('routes/seed — handlers', () => {
  it('handleSeed returns seeded=true on a clean org', async () => {
    const db = makeMockDb();
    const { seeded, summary } = await handleSeed('org_1', db as any);
    expect(seeded).to.equal(true);
    expect(summary.clients).to.be.greaterThan(0);
  });

  it('handleSeed returns seeded=false when data is already seeded (maps to 409 in the route)', async () => {
    const db = makeMockDb();
    await handleSeed('org_1', db as any);
    const second = await handleSeed('org_1', db as any);
    expect(second.seeded).to.equal(false);
    expect(second.summary).to.deep.equal({ clients: 0, time_entries: 0, invoices: 0, adopted: 0 });
  });

  it('handleReseed wipes and reinserts, returning fresh counts', async () => {
    const db = makeMockDb();
    await handleSeed('org_1', db as any);
    const clientsBefore = db._tables.clients.length;
    const out = await handleReseed('org_1', db as any);
    expect(out.clients).to.equal(clientsBefore); // same count after re-seed
    // The rows after reseed have different ids than before (fresh insert).
    const stillSeeded = db._tables.clients.every((c: Row) => c.seeded_at !== null);
    expect(stillSeeded).to.equal(true);
  });

  it('handleRemoveSeed deletes all seeded rows', async () => {
    const db = makeMockDb();
    await handleSeed('org_1', db as any);
    const out = await handleRemoveSeed('org_1', db as any);
    expect(out.clients).to.be.greaterThan(0);
    expect(db._tables.clients).to.have.length(0);
  });
});

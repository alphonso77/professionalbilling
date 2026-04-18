import { expect } from 'chai';

import { ensurePaymentIntent } from '../../../src/services/ensure-payment-intent';
import { AppError } from '../../../src/middleware/error-handler';

type Row = Record<string, unknown>;

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    invoices: [],
    platforms: [],
    clients: [],
  };

  function query(tableName: string) {
    const conds: Array<(r: Row) => boolean> = [];
    let cols: string[] | null = null;

    const api: any = {
      where(cond: Record<string, unknown>) {
        conds.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
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
        const out: Row = {};
        for (const c of cols) out[c] = match[c];
        return out;
      },
      update(patch: Row) {
        const matched = tables[tableName].filter((r) => conds.every((f) => f(r)));
        for (const r of matched) Object.assign(r, patch);
        return Promise.resolve(matched.length);
      },
    };
    return api;
  }

  const fn: any = (t: string) => query(t);
  fn._tables = tables;
  fn._seed = (t: string, row: Row) => {
    tables[t].push(row);
  };
  return fn;
}

describe('services/ensure-payment-intent', () => {
  it('returns the existing PI + secret when already set (no Stripe call)', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      client_id: 'c1',
      status: 'open',
      total_cents: 10_000,
      stripe_payment_intent_id: 'pi_existing',
      stripe_client_secret: 'pi_existing_secret',
      number: '2026-0001',
    });

    let calls = 0;
    const result = await ensurePaymentIntent('inv_1', db as any, {
      createPaymentIntent: async () => {
        calls += 1;
        return { paymentIntentId: 'pi_new', clientSecret: 'pi_new_secret' };
      },
    });

    expect(calls).to.equal(0);
    expect(result.paymentIntentId).to.equal('pi_existing');
    expect(result.clientSecret).to.equal('pi_existing_secret');
  });

  it('creates a PI and persists it when missing', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      client_id: 'c1',
      status: 'open',
      total_cents: 20_000,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
      number: '2026-0007',
    });
    db._seed('platforms', {
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
      credentials_encrypted: null,
      credentials_iv: null,
      credentials_tag: null,
    });
    db._seed('clients', { id: 'c1', email: 'bill@example.com' });

    let createArgs: { acct?: string; total?: number; id?: string } = {};
    const result = await ensurePaymentIntent('inv_1', db as any, {
      createPaymentIntent: async (inv, acct) => {
        createArgs = { acct, total: inv.totalCents, id: inv.id };
        return { paymentIntentId: 'pi_fresh', clientSecret: 'pi_fresh_secret' };
      },
    });

    expect(createArgs).to.deep.equal({ acct: 'acct_abc', total: 20_000, id: 'inv_1' });
    expect(result.paymentIntentId).to.equal('pi_fresh');
    expect(result.clientSecret).to.equal('pi_fresh_secret');
    // The invoice row was mutated with the new PI fields.
    const stored = db._tables.invoices[0];
    expect(stored.stripe_payment_intent_id).to.equal('pi_fresh');
    expect(stored.stripe_client_secret).to.equal('pi_fresh_secret');
  });

  it('throws 503 when the org has no Stripe platform row', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      client_id: 'c1',
      status: 'open',
      total_cents: 10_000,
      stripe_payment_intent_id: null,
      stripe_client_secret: null,
      number: '2026-0001',
    });

    let caught: unknown;
    try {
      await ensurePaymentIntent('inv_1', db as any, {
        createPaymentIntent: async () => ({ paymentIntentId: 'x', clientSecret: 'y' }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(503);
  });

  it('throws 404 when the invoice is missing', async () => {
    const db = makeMockDb();
    let caught: unknown;
    try {
      await ensurePaymentIntent('inv_missing', db as any, {
        createPaymentIntent: async () => ({ paymentIntentId: 'x', clientSecret: 'y' }),
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });
});

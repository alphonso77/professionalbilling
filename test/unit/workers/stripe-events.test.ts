import { expect } from 'chai';

import { handleChargeRefunded } from '../../../src/workers/stripe-events';

type Row = Record<string, unknown>;

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    invoices: [],
    invoice_refunds: [],
  };

  function query(tableName: string) {
    const conds: Array<(r: Row) => boolean> = [];
    let cols: string[] | null = null;
    let onConflictCol: string | null = null;
    let onConflictIgnore = false;

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
      insert(payload: Row) {
        const runner = {
          onConflict(col: string) {
            onConflictCol = col;
            return runner;
          },
          ignore() {
            onConflictIgnore = true;
            return runner.then ? runner : doInsert();
          },
          async then(resolve: () => void) {
            await doInsert();
            resolve();
          },
        };

        const doInsert = async () => {
          if (
            onConflictCol &&
            onConflictIgnore &&
            tables[tableName].some((r) => r[onConflictCol!] === payload[onConflictCol!])
          ) {
            return;
          }
          tables[tableName].push({
            id: `${tableName}-${tables[tableName].length + 1}`,
            ...payload,
          });
        };

        return runner as unknown as Promise<void> & typeof runner;
      },
    };
    return api;
  }

  const fn: any = (t: string) => query(t);
  fn._tables = tables;
  fn._seed = (t: string, row: Row) => tables[t].push(row);
  fn.transaction = async (work: (trx: typeof fn) => Promise<void>) => {
    await work(fn);
  };
  fn.fn = { now: () => 'now()' };
  return fn;
}

function chargeRefundedEvent(overrides: {
  eventId?: string;
  chargeId?: string;
  paymentIntentId?: string | null;
  amount?: number;
  amountRefunded?: number;
  refunded?: boolean;
  previousAmountRefunded?: number;
  created?: number;
} = {}) {
  const pi = 'paymentIntentId' in overrides ? overrides.paymentIntentId : 'pi_1';
  return {
    id: overrides.eventId ?? 'evt_1',
    created: overrides.created ?? 1776977764,
    data: {
      object: {
        id: overrides.chargeId ?? 'ch_1',
        payment_intent: pi,
        amount: overrides.amount ?? 10000,
        amount_refunded: overrides.amountRefunded ?? 10000,
        refunded: overrides.refunded ?? true,
      },
      previous_attributes: {
        amount_refunded: overrides.previousAmountRefunded ?? 0,
      },
    },
  };
}

describe('workers/stripe-events — handleChargeRefunded', () => {
  it('records a refund row and flips status to refunded on a full refund', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(db as any, chargeRefundedEvent());

    expect(outcome).to.equal('handled');
    expect(db._tables.invoice_refunds).to.have.length(1);
    expect(db._tables.invoice_refunds[0]).to.include({
      invoice_id: 'inv_1',
      org_id: 'org_1',
      stripe_charge_id: 'ch_1',
      stripe_event_id: 'evt_1',
      amount_cents: 10000,
    });
    expect(db._tables.invoices[0].status).to.equal('refunded');
  });

  it('records a refund row but keeps status paid on a partial refund', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(
      db as any,
      chargeRefundedEvent({
        amount: 10000,
        amountRefunded: 3000,
        previousAmountRefunded: 0,
        refunded: false,
      })
    );

    expect(outcome).to.equal('handled');
    expect(db._tables.invoice_refunds).to.have.length(1);
    expect(db._tables.invoice_refunds[0]).to.include({
      stripe_event_id: 'evt_1',
      amount_cents: 3000,
    });
    expect(db._tables.invoices[0].status).to.equal('paid');
  });

  it('derives delta from previous_attributes when refunded on top of a prior partial refund', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(
      db as any,
      chargeRefundedEvent({
        eventId: 'evt_second',
        amount: 10000,
        amountRefunded: 10000,
        previousAmountRefunded: 3000,
        refunded: true,
      })
    );

    expect(outcome).to.equal('handled');
    expect(db._tables.invoice_refunds).to.have.length(1);
    expect(db._tables.invoice_refunds[0]).to.include({
      stripe_event_id: 'evt_second',
      amount_cents: 7000,
    });
    expect(db._tables.invoices[0].status).to.equal('refunded');
  });

  it('is idempotent: re-processing the same event id inserts nothing new', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    await handleChargeRefunded(db as any, chargeRefundedEvent());
    await handleChargeRefunded(db as any, chargeRefundedEvent());

    expect(db._tables.invoice_refunds).to.have.length(1);
  });

  it('ignores the event when no invoice matches the payment_intent', async () => {
    const db = makeMockDb();
    // no invoice seeded

    const outcome = await handleChargeRefunded(db as any, chargeRefundedEvent());

    expect(outcome).to.equal('ignored');
    expect(db._tables.invoice_refunds).to.have.length(0);
  });

  it('ignores the event when the refund delta is zero or negative', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(
      db as any,
      chargeRefundedEvent({
        amountRefunded: 5000,
        previousAmountRefunded: 5000,
        refunded: false,
      })
    );

    expect(outcome).to.equal('ignored');
    expect(db._tables.invoice_refunds).to.have.length(0);
    expect(db._tables.invoices[0].status).to.equal('paid');
  });

  it('ignores the event when payment_intent is missing on the charge', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'paid',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(
      db as any,
      chargeRefundedEvent({ paymentIntentId: null })
    );

    expect(outcome).to.equal('ignored');
    expect(db._tables.invoice_refunds).to.have.length(0);
  });

  it('does not downgrade a void invoice to refunded', async () => {
    const db = makeMockDb();
    db._seed('invoices', {
      id: 'inv_1',
      org_id: 'org_1',
      status: 'void',
      total_cents: 10000,
      stripe_payment_intent_id: 'pi_1',
    });

    const outcome = await handleChargeRefunded(db as any, chargeRefundedEvent());

    expect(outcome).to.equal('handled');
    expect(db._tables.invoice_refunds).to.have.length(1);
    expect(db._tables.invoices[0].status).to.equal('void');
  });
});

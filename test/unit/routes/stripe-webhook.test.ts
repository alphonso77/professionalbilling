import { expect } from 'chai';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import stripeWebhookRouter, {
  handleStripeEvent,
  type StripeEventQueue,
} from '../../../src/routes/stripe-webhook';
import type { StripeEvent, StripeEventJobData } from '../../../src/config/queues';

type Row = Record<string, unknown>;
type Table = Row[];

function makeMockDb() {
  const tables: Record<string, Table> = {
    audit_log: [],
    platforms: [],
  };

  function query(tableName: string) {
    let whereClause: Partial<Row> | null = null;
    let insertPayload: Row | Row[] | null = null;

    function commitInsert() {
      const payloads = Array.isArray(insertPayload) ? insertPayload : [insertPayload!];
      for (const row of payloads) {
        tables[tableName].push({
          id: `mock-${tableName}-${tables[tableName].length + 1}`,
          ...row,
        });
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
        return tables[tableName].find((r) =>
          whereClause ? Object.entries(whereClause).every(([k, v]) => r[k] === v) : true
        );
      },
      insert(payload: Row | Row[]) {
        insertPayload = payload;
        const run = async () => {
          commitInsert();
        };
        const p = run();
        return {
          then: p.then.bind(p),
          catch: p.catch.bind(p),
          finally: p.finally.bind(p),
        };
      },
    };
    return api;
  }

  const mock: any = (t: string) => query(t);
  mock._tables = tables;
  mock._seedPlatform = (row: Row) => tables.platforms.push(row);
  return mock;
}

interface QueueSpy extends StripeEventQueue {
  _calls: Array<[string, StripeEventJobData, unknown]>;
}

function makeQueueSpy(override?: StripeEventQueue['add']): QueueSpy {
  const calls: QueueSpy['_calls'] = [];
  return {
    async add(name, data, opts) {
      if (override) return override(name, data, opts);
      calls.push([name, data, opts]);
      return undefined;
    },
    _calls: calls,
  };
}

function makeEvent(overrides: Partial<StripeEvent> = {}): StripeEvent {
  return {
    id: 'evt_test_1',
    type: 'invoice.paid',
    account: 'acct_abc',
    object: 'event',
    api_version: '2024-11-20',
    created: 1700000000,
    data: { object: { id: 'in_1' } },
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    ...overrides,
  } as unknown as StripeEvent;
}

describe('routes/stripe-webhook — handleStripeEvent', () => {
  it('ignores (200) an event with no event.account — platform-level event', async () => {
    const db = makeMockDb();
    const queue = makeQueueSpy();

    const res = await handleStripeEvent(makeEvent({ account: undefined }), queue, db);

    expect(res.status).to.equal(200);
    expect(queue._calls).to.have.length(0);
    expect(db._tables.audit_log).to.have.length(1);
    expect(db._tables.audit_log[0]).to.include({
      source: 'stripe',
      event_type: 'invoice.paid',
      status: 'ignored',
    });
  });

  it('ignores (200) an event whose account is not registered (fail-open, no enqueue)', async () => {
    const db = makeMockDb();
    const queue = makeQueueSpy();

    const res = await handleStripeEvent(makeEvent(), queue, db);

    expect(res.status).to.equal(200);
    expect(queue._calls).to.have.length(0);
    expect(db._tables.audit_log[0]).to.include({ status: 'ignored' });
  });

  it('enqueues + writes processed audit row when account matches a platform row', async () => {
    const db = makeMockDb();
    db._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
    });
    const queue = makeQueueSpy();

    const res = await handleStripeEvent(makeEvent(), queue, db);

    expect(res.status).to.equal(200);
    expect(queue._calls).to.have.length(1);
    const [jobName, data, opts] = queue._calls[0];
    expect(jobName).to.equal('invoice.paid');
    expect(data).to.include({
      eventId: 'evt_test_1',
      eventType: 'invoice.paid',
      accountId: 'acct_abc',
      orgId: 'org_1',
    });
    expect(opts).to.deep.equal({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
    expect(db._tables.audit_log[0]).to.include({
      source: 'stripe',
      status: 'processed',
      org_id: 'org_1',
      external_id: 'evt_test_1',
    });
  });

  it('returns 500 + writes error audit row when the queue throws', async () => {
    const db = makeMockDb();
    db._seedPlatform({
      id: 'plat_1',
      org_id: 'org_1',
      type: 'stripe',
      external_account_id: 'acct_abc',
    });
    const queue = makeQueueSpy(async () => {
      throw new Error('redis unreachable');
    });

    const res = await handleStripeEvent(makeEvent(), queue, db);

    expect(res.status).to.equal(500);
    expect(db._tables.audit_log.at(-1)).to.include({
      status: 'error',
      error_detail: 'redis unreachable',
    });
  });
});

describe('routes/stripe-webhook — router signature verification', () => {
  let server: Server;
  let baseUrl: string;

  before((done) => {
    const app = express();
    app.use('/stripe', express.raw({ type: 'application/json' }), stripeWebhookRouter);
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((done) => {
    server.close(() => done());
  });

  it('returns 400 when the Stripe signature header is invalid', async () => {
    const res = await fetch(`${baseUrl}/stripe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': 't=1,v1=deadbeef',
      },
      body: JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }),
    });
    expect(res.status).to.equal(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).to.equal('invalid_signature');
  });

  it('returns 400 when the stripe-signature header is missing', async () => {
    const res = await fetch(`${baseUrl}/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_1', type: 'invoice.paid' }),
    });
    expect(res.status).to.equal(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).to.equal('missing_stripe_signature');
  });
});

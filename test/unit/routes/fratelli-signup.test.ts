import { expect } from 'chai';
import express from 'express';
import crypto from 'node:crypto';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import fratelliSignupRouter, {
  handleFratelliSignup,
  verifyFratelliSignature,
  type FratelliSignupQueue,
} from '../../../src/routes/fratelli-signup';
import type { WelcomeEmailJobData } from '../../../src/config/queues';

type Row = Record<string, unknown>;

function makeMockDb() {
  const tables: Record<string, Row[]> = { audit_log: [] };

  function query(table: string) {
    let whereClause: Partial<Row> | null = null;
    const api: any = {
      where(c: Partial<Row>) {
        whereClause = c;
        return api;
      },
      select() {
        return api;
      },
      async first() {
        return tables[table].find((r) =>
          whereClause ? Object.entries(whereClause).every(([k, v]) => r[k] === v) : true
        );
      },
      insert(payload: Row) {
        tables[table].push({ id: `r${tables[table].length + 1}`, ...payload });
        return Promise.resolve();
      },
    };
    return api;
  }

  const mock: any = (t: string) => query(t);
  mock._tables = tables;
  return mock;
}

function makeQueueSpy(): FratelliSignupQueue & { _calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    async add(name, data) {
      calls.push([name, data]);
      return undefined;
    },
    _calls: calls,
  };
}

const PAYLOAD = {
  event: 'signup.completed' as const,
  occurredAt: '2026-04-21T12:00:00Z',
  email: 'alice@acme.com',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  trialEndAt: 1_700_000_000_000,
};

describe('routes/fratelli-signup — verifyFratelliSignature', () => {
  const secret = 'shh';
  const body = Buffer.from('{"hello":"world"}');
  const goodHex = crypto.createHmac('sha256', secret).update(body).digest('hex');

  it('accepts a correctly signed body', () => {
    expect(verifyFratelliSignature(body, `sha256=${goodHex}`, secret)).to.equal(true);
  });

  it('rejects when the prefix is missing', () => {
    expect(verifyFratelliSignature(body, goodHex, secret)).to.equal(false);
  });

  it('rejects when the hex is wrong', () => {
    const bad = 'sha256=' + 'a'.repeat(64);
    expect(verifyFratelliSignature(body, bad, secret)).to.equal(false);
  });

  it('rejects when the header is missing', () => {
    expect(verifyFratelliSignature(body, undefined, secret)).to.equal(false);
  });

  it('rejects when the signature is the wrong length', () => {
    expect(verifyFratelliSignature(body, 'sha256=abc', secret)).to.equal(false);
  });
});

describe('routes/fratelli-signup — handleFratelliSignup', () => {
  function makeProvisionSpy() {
    const calls: unknown[] = [];
    const fn = async (input: unknown) => {
      calls.push(input);
      return {
        clerkUserId: 'user_stub',
        clerkOrgId: 'org_stub',
        reused: false,
      };
    };
    (fn as unknown as { _calls: unknown[] })._calls = calls;
    return fn as typeof fn & { _calls: unknown[] };
  }

  it('provisions, enqueues welcome-email, and audits on first receipt', async () => {
    const db = makeMockDb();
    const queue = makeQueueSpy();
    const provision = makeProvisionSpy();

    const res = await handleFratelliSignup(PAYLOAD, queue, db, provision);

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.include({ received: true, reused: false });
    expect(provision._calls).to.have.length(1);
    expect(queue._calls).to.have.length(1);
    const [, job] = queue._calls[0] as [string, WelcomeEmailJobData];
    expect(job).to.deep.include({
      email: PAYLOAD.email,
      stripeSubscriptionId: PAYLOAD.stripeSubscriptionId,
    });
    expect(db._tables.audit_log).to.have.length(1);
    expect(db._tables.audit_log[0]).to.include({
      source: 'fratelli.signup',
      event_type: 'signup.completed',
      external_id: PAYLOAD.stripeSubscriptionId,
      status: 'processed',
    });
  });

  it('short-circuits on replay with a matching processed audit row', async () => {
    const db = makeMockDb();
    db._tables.audit_log.push({
      source: 'fratelli.signup',
      external_id: PAYLOAD.stripeSubscriptionId,
      status: 'processed',
    });
    const queue = makeQueueSpy();
    const provision = makeProvisionSpy();

    const res = await handleFratelliSignup(PAYLOAD, queue, db, provision);

    expect(res.status).to.equal(200);
    expect(res.body).to.deep.include({ received: true, reused: true });
    expect(provision._calls).to.have.length(0);
    expect(queue._calls).to.have.length(0);
  });

  it('returns 500 and writes an error audit row when provisioning throws', async () => {
    const db = makeMockDb();
    const queue = makeQueueSpy();
    const provision = async () => {
      throw new Error('clerk down');
    };

    const res = await handleFratelliSignup(PAYLOAD, queue, db, provision);
    expect(res.status).to.equal(500);
    expect(db._tables.audit_log.at(-1)).to.include({
      status: 'error',
      error_detail: 'clerk down',
    });
  });
});

describe('routes/fratelli-signup — router signature guard', () => {
  let server: Server;
  let baseUrl: string;
  const prevSecret = process.env.PB_WEBHOOK_SECRET;

  before((done) => {
    process.env.PB_WEBHOOK_SECRET = 'test-secret';
    // Re-read env module so the router sees the secret. The env module
    // is already loaded at `require('../../../src/routes/fratelli-signup')`
    // via the earlier describe block, but it reads env.PB_WEBHOOK_SECRET
    // on every request, so mutating process.env isn't enough. Invalidate
    // the cached env module so it re-parses.
    delete require.cache[require.resolve('../../../src/config/env')];
    delete require.cache[require.resolve('../../../src/routes/fratelli-signup')];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { default: router } = require('../../../src/routes/fratelli-signup');

    const app = express();
    app.use('/fs', express.raw({ type: 'application/json' }), router);
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((done) => {
    process.env.PB_WEBHOOK_SECRET = prevSecret;
    server.close(() => done());
  });

  it('returns 401 when the signature is missing', async () => {
    const body = JSON.stringify(PAYLOAD);
    const res = await fetch(`${baseUrl}/fs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).to.equal(401);
  });

  it('returns 401 when the signature is wrong', async () => {
    const body = JSON.stringify(PAYLOAD);
    const res = await fetch(`${baseUrl}/fs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fratelli-signature': 'sha256=' + 'f'.repeat(64),
      },
      body,
    });
    expect(res.status).to.equal(401);
  });

  it('returns 400 on malformed JSON', async () => {
    const bad = '{ not json';
    const sig = crypto
      .createHmac('sha256', 'test-secret')
      .update(bad)
      .digest('hex');
    const res = await fetch(`${baseUrl}/fs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fratelli-signature': `sha256=${sig}`,
      },
      body: bad,
    });
    expect(res.status).to.equal(400);
  });

  it('returns 400 on a payload that fails zod validation', async () => {
    const bad = JSON.stringify({ event: 'signup.completed', email: 'not-an-email' });
    const sig = crypto
      .createHmac('sha256', 'test-secret')
      .update(bad)
      .digest('hex');
    const res = await fetch(`${baseUrl}/fs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-fratelli-signature': `sha256=${sig}`,
      },
      body: bad,
    });
    expect(res.status).to.equal(400);
  });
});

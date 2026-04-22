import { expect } from 'chai';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import publicOfferCodesRouter from '../../../src/routes/public-offer-codes';
import { errorHandler } from '../../../src/middleware/error-handler';

/**
 * Smoke test the public router's validation + error shape. The underlying
 * service (`redeemOfferCode`) hits the DB + Clerk; we don't exercise those
 * here — that's covered in offer-codes.test.ts.
 */
describe('routes/public-offer-codes — POST /redeem', () => {
  let server: Server;
  let baseUrl: string;

  before((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/public/offer-codes', publicOfferCodesRouter);
    app.use(errorHandler);
    server = app.listen(0, () => {
      const port = (server.address() as AddressInfo).port;
      baseUrl = `http://127.0.0.1:${port}`;
      done();
    });
  });

  after((done) => {
    server.close(() => done());
  });

  it('returns 400 INVALID_CODE when the code format is wrong', async () => {
    const res = await fetch(`${baseUrl}/api/public/offer-codes/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'abc', email: 'a@b.com' }),
    });
    expect(res.status).to.equal(400);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string };
    };
    expect(body.error?.code).to.equal('INVALID_CODE');
  });

  it('returns 400 when email is missing', async () => {
    const res = await fetch(`${baseUrl}/api/public/offer-codes/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(res.status).to.equal(400);
  });
});

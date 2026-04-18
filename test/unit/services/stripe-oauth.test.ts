import { expect } from 'chai';
import axios, { AxiosError } from 'axios';

import { deauthorizeStripeAccount } from '../../../src/services/stripe-oauth';

type PostArgs = [url: string, body: unknown, config: { headers: Record<string, string>; timeout: number }];

function stubAxiosPost(impl: (...args: PostArgs) => Promise<unknown>) {
  const original = axios.post;
  (axios as unknown as { post: unknown }).post = impl as unknown;
  return () => {
    (axios as unknown as { post: unknown }).post = original;
  };
}

function makeAxiosError(opts: {
  status: number;
  data?: { error?: string; error_description?: string };
  code?: string;
  message?: string;
}): AxiosError {
  const err = new Error(opts.message ?? `Request failed with status ${opts.status}`) as AxiosError;
  err.isAxiosError = true;
  err.code = opts.code;
  if (opts.status) {
    err.response = {
      status: opts.status,
      statusText: '',
      headers: {},
      config: {} as AxiosError['config'],
      data: opts.data ?? {},
    } as AxiosError['response'];
  }
  return err;
}

describe('services/stripe-oauth — deauthorizeStripeAccount', () => {
  let restore: () => void = () => {};

  afterEach(() => {
    restore();
    restore = () => {};
  });

  it('success: POSTs form body with client_id + stripe_user_id and platform Bearer auth', async () => {
    let capturedUrl: string | undefined;
    let capturedBody: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    let capturedTimeout: number | undefined;

    restore = stubAxiosPost(async (url, body, config) => {
      capturedUrl = url;
      capturedBody = body as string;
      capturedHeaders = config.headers;
      capturedTimeout = config.timeout;
      return { status: 200, data: { stripe_user_id: 'acct_abc' } };
    });

    const result = await deauthorizeStripeAccount({ stripeUserId: 'acct_abc' });

    expect(result).to.deep.equal({ deauthorized: true });
    expect(capturedUrl).to.equal('https://connect.stripe.com/oauth/deauthorize');
    expect(capturedBody).to.be.a('string');
    const parsed = new URLSearchParams(capturedBody!);
    expect(parsed.get('client_id')).to.equal(process.env.STRIPE_CLIENT_ID);
    expect(parsed.get('stripe_user_id')).to.equal('acct_abc');
    expect(capturedHeaders?.['Authorization']).to.equal(`Bearer ${process.env.STRIPE_SECRET_KEY}`);
    expect(capturedHeaders?.['Content-Type']).to.equal('application/x-www-form-urlencoded');
    expect(capturedTimeout).to.equal(10_000);
  });

  it('returns alreadyRevoked=true when Stripe responds 400 with error=invalid_client', async () => {
    restore = stubAxiosPost(async () => {
      throw makeAxiosError({ status: 400, data: { error: 'invalid_client' } });
    });

    const result = await deauthorizeStripeAccount({ stripeUserId: 'acct_abc' });

    expect(result).to.deep.equal({ deauthorized: true, alreadyRevoked: true });
  });

  it('returns alreadyRevoked=true when Stripe responds 400 with error=account_not_connected', async () => {
    restore = stubAxiosPost(async () => {
      throw makeAxiosError({ status: 400, data: { error: 'account_not_connected' } });
    });

    const result = await deauthorizeStripeAccount({ stripeUserId: 'acct_abc' });

    expect(result).to.deep.equal({ deauthorized: true, alreadyRevoked: true });
  });

  it('throws on other 4xx errors (e.g. 401 unauthorized)', async () => {
    restore = stubAxiosPost(async () => {
      throw makeAxiosError({
        status: 401,
        data: { error: 'invalid_request', error_description: 'bad auth' },
      });
    });

    let caught: unknown;
    try {
      await deauthorizeStripeAccount({ stripeUserId: 'acct_abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.exist;
    expect((caught as AxiosError).response?.status).to.equal(401);
  });

  it('throws on timeout (axios ECONNABORTED)', async () => {
    restore = stubAxiosPost(async () => {
      throw makeAxiosError({ status: 0, code: 'ECONNABORTED', message: 'timeout of 10000ms exceeded' });
    });

    let caught: unknown;
    try {
      await deauthorizeStripeAccount({ stripeUserId: 'acct_abc' });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.exist;
    expect((caught as AxiosError).code).to.equal('ECONNABORTED');
    expect((caught as Error).message).to.contain('timeout');
  });
});

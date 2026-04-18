import { expect } from 'chai';
import type { Knex } from 'knex';

import {
  handlePublicInvoice,
  type PublicInvoiceDeps,
} from '../../../src/routes/public-invoices';

function makeDeps(overrides?: Partial<PublicInvoiceDeps>): PublicInvoiceDeps & {
  _invoices: Record<string, unknown>[];
} {
  const invoices: Record<string, unknown>[] = [];

  const mockDb: any = (table: string) => {
    let conds: Array<(r: any) => boolean> = [];
    let cols: string[] | null = null;
    const api: any = {
      where(cond: Record<string, unknown>) {
        conds.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        return api;
      },
      select(...c: string[]) {
        cols = c;
        return api;
      },
      async first() {
        const rows =
          table === 'invoices' ? invoices : [];
        const match = rows.find((r) => conds.every((f) => f(r)));
        if (!match) return undefined;
        if (!cols) return match;
        const out: any = {};
        for (const c of cols) out[c] = (match as any)[c];
        return out;
      },
    };
    return api;
  };

  const base: PublicInvoiceDeps = {
    db: mockDb as unknown as Knex,
    stripePublishableKey: 'pk_test_123',
    findPlatform: async () => ({ external_account_id: 'acct_abc' }),
    findOrg: async () => ({ name: 'Acme Law LLP' }),
    findClient: async () => ({ name: 'Wile E. Coyote' }),
  };

  return Object.assign({ ...base, ...overrides }, { _invoices: invoices });
}

describe('routes/public-invoices — handlePublicInvoice', () => {
  it('404 when the invoice does not exist', async () => {
    const deps = makeDeps();
    const res = await handlePublicInvoice(
      '00000000-0000-0000-0000-000000000001',
      'whatever',
      deps
    );
    expect(res.status).to.equal(404);
  });

  it('404 when the token does not match (timing-safe)', async () => {
    const deps = makeDeps();
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'open',
      payment_token: 'tok_correct',
      stripe_client_secret: 'pi_sec',
      org_id: 'org_1',
      client_id: 'client_1',
    });

    const res = await handlePublicInvoice('inv_1', 'tok_wrong', deps);
    expect(res.status).to.equal(404);
  });

  it('404 when the token length differs (short-circuit path must not throw)', async () => {
    const deps = makeDeps();
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'open',
      payment_token: 'tok_correct_longer_string',
      stripe_client_secret: 'pi_sec',
      org_id: 'org_1',
      client_id: 'client_1',
    });

    const res = await handlePublicInvoice('inv_1', 'tok', deps);
    expect(res.status).to.equal(404);
  });

  it('410 when the invoice is paid', async () => {
    const deps = makeDeps();
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'paid',
      payment_token: 'tok_ok',
      stripe_client_secret: 'pi_sec',
      org_id: 'org_1',
      client_id: 'client_1',
    });
    const res = await handlePublicInvoice('inv_1', 'tok_ok', deps);
    expect(res.status).to.equal(410);
  });

  it('410 when the invoice is void', async () => {
    const deps = makeDeps();
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'void',
      payment_token: 'tok_ok',
      stripe_client_secret: null,
      org_id: 'org_1',
      client_id: 'client_1',
    });
    const res = await handlePublicInvoice('inv_1', 'tok_ok', deps);
    expect(res.status).to.equal(410);
  });

  it('200 with PublicInvoicePayment shape when token matches and invoice is open', async () => {
    const deps = makeDeps();
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0042',
      total_cents: 12_345,
      status: 'open',
      payment_token: 'tok_xyz',
      stripe_client_secret: 'pi_xyz_secret',
      org_id: 'org_1',
      client_id: 'client_1',
    });

    const res = await handlePublicInvoice('inv_1', 'tok_xyz', deps);
    expect(res.status).to.equal(200);
    const body = res.body as { data: any };
    expect(body.data.invoice).to.deep.include({
      id: 'inv_1',
      number: '2026-0042',
      totalCents: 12_345,
      currency: 'usd',
      status: 'open',
      orgName: 'Acme Law LLP',
      clientName: 'Wile E. Coyote',
    });
    expect(body.data.stripeClientSecret).to.equal('pi_xyz_secret');
    expect(body.data.stripePublishableKey).to.equal('pk_test_123');
    expect(body.data.connectedAccountId).to.equal('acct_abc');
  });

  it('503 when STRIPE_PUBLISHABLE_KEY is missing (server misconfig)', async () => {
    const deps = makeDeps({ stripePublishableKey: undefined });
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'open',
      payment_token: 'tok_ok',
      stripe_client_secret: 'pi_sec',
      org_id: 'org_1',
      client_id: 'client_1',
    });
    const res = await handlePublicInvoice('inv_1', 'tok_ok', deps);
    expect(res.status).to.equal(503);
  });

  it('lazily creates the PaymentIntent on first view when missing', async () => {
    let ensureCalls = 0;
    const deps = makeDeps({
      ensurePaymentIntent: async (invoiceId) => {
        ensureCalls += 1;
        expect(invoiceId).to.equal('inv_1');
        return { paymentIntentId: 'pi_fresh', clientSecret: 'pi_fresh_secret' };
      },
    });
    deps._invoices.push({
      id: 'inv_1',
      number: '2026-0001',
      total_cents: 10_000,
      status: 'open',
      payment_token: 'tok_ok',
      stripe_client_secret: null,
      org_id: 'org_1',
      client_id: 'client_1',
    });
    const res = await handlePublicInvoice('inv_1', 'tok_ok', deps);
    expect(res.status).to.equal(200);
    expect(ensureCalls).to.equal(1);
    const body = res.body as { data: any };
    expect(body.data.stripeClientSecret).to.equal('pi_fresh_secret');
  });
});

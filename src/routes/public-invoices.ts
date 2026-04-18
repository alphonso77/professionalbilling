import crypto from 'node:crypto';
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Knex } from 'knex';
import { z } from 'zod';

import { db } from '../config/database';
import { env } from '../config/env';
import { registry } from '../openapi/registry';
import { ensurePaymentIntent } from '../services/ensure-payment-intent';
import { AppError } from '../middleware/error-handler';

const PublicInvoicePaymentSchema = z
  .object({
    invoice: z.object({
      id: z.string().uuid(),
      number: z.string(),
      totalCents: z.number().int(),
      currency: z.literal('usd'),
      status: z.enum(['draft', 'open', 'paid', 'void']),
      orgName: z.string(),
      clientName: z.string(),
    }),
    stripeClientSecret: z.string(),
    stripePublishableKey: z.string(),
    connectedAccountId: z.string(),
  })
  .openapi('PublicInvoicePayment');

const Response200 = z.object({ data: PublicInvoicePaymentSchema });

registry.registerPath({
  method: 'get',
  path: '/api/public/invoices/{id}',
  tags: ['public'],
  summary: 'Public payment payload — unauthenticated, token-gated',
  description:
    "Returns the minimal data the public payment page needs to render Stripe's " +
    'Payment Element on the connected account. 404 on bad id/token (single code, no enumeration).',
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ token: z.string() }),
  },
  responses: {
    200: { description: 'Invoice payment payload', content: { 'application/json': { schema: Response200 } } },
    404: { description: 'Not found or bad token' },
    410: { description: 'Invoice is paid or void' },
    503: { description: 'Configuration not ready (publishable key or Stripe platform missing)' },
  },
});

interface InvoiceLookup {
  id: string;
  number: string | null;
  total_cents: string | number;
  status: string;
  payment_token: string | null;
  stripe_client_secret: string | null;
  org_id: string;
  client_id: string;
}

export interface PublicInvoiceDeps {
  db: Knex;
  stripePublishableKey: string | undefined;
  findPlatform: (orgId: string) => Promise<{ external_account_id: string | null } | undefined>;
  findOrg: (orgId: string) => Promise<{ name: string } | undefined>;
  findClient: (clientId: string) => Promise<{ name: string } | undefined>;
  ensurePaymentIntent?: (
    invoiceId: string,
    t: (table: string) => Knex.QueryBuilder
  ) => Promise<{ paymentIntentId: string; clientSecret: string }>;
}

export function defaultDeps(): PublicInvoiceDeps {
  return {
    db,
    stripePublishableKey: env.STRIPE_PUBLISHABLE_KEY,
    findPlatform: (orgId) =>
      db('platforms').where({ org_id: orgId, type: 'stripe' }).select('external_account_id').first(),
    findOrg: (orgId) => db('organizations').where({ id: orgId }).select('name').first(),
    findClient: (clientId) => db('clients').where({ id: clientId }).select('name').first(),
    ensurePaymentIntent: (invoiceId, t) => ensurePaymentIntent(invoiceId, t),
  };
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface PublicResult {
  status: number;
  body: unknown;
}

export async function handlePublicInvoice(
  id: string,
  token: string,
  deps: PublicInvoiceDeps
): Promise<PublicResult> {
  const invoice = (await deps
    .db('invoices')
    .where({ id })
    .select(
      'id',
      'number',
      'total_cents',
      'status',
      'payment_token',
      'stripe_client_secret',
      'org_id',
      'client_id'
    )
    .first()) as InvoiceLookup | undefined;

  if (!invoice || !invoice.payment_token || !timingSafeEqualStr(invoice.payment_token, token)) {
    return { status: 404, body: { error: { message: 'Not found' } } };
  }

  if (invoice.status === 'paid' || invoice.status === 'void') {
    return { status: 410, body: { error: { message: 'Invoice is no longer payable' } } };
  }

  if (invoice.status !== 'open' || !invoice.number) {
    return { status: 410, body: { error: { message: 'Invoice is not payable' } } };
  }

  const publishableKey = deps.stripePublishableKey;
  if (!publishableKey) {
    return {
      status: 503,
      body: { error: { message: 'Server misconfigured: STRIPE_PUBLISHABLE_KEY missing' } },
    };
  }

  // Lazy PI: if the invoice doesn't have a client_secret yet, create one now.
  // A failure here (e.g. the org hasn't connected Stripe) surfaces as 503.
  let clientSecret = invoice.stripe_client_secret;
  if (!clientSecret) {
    const ensureFn = deps.ensurePaymentIntent;
    if (!ensureFn) {
      return {
        status: 503,
        body: { error: { message: 'Payment intent provisioning unavailable' } },
      };
    }
    try {
      const ensured = await deps.db.transaction((trx) =>
        ensureFn(invoice.id, (table: string) => trx(table))
      );
      clientSecret = ensured.clientSecret;
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 503) {
        return { status: 503, body: { error: { message: err.message } } };
      }
      throw err;
    }
  }

  const [platform, org, client] = await Promise.all([
    deps.findPlatform(invoice.org_id),
    deps.findOrg(invoice.org_id),
    deps.findClient(invoice.client_id),
  ]);

  if (!platform?.external_account_id) {
    return {
      status: 503,
      body: { error: { message: 'Stripe platform not configured for this org' } },
    };
  }

  return {
    status: 200,
    body: {
      data: {
        invoice: {
          id: invoice.id,
          number: invoice.number,
          totalCents: typeof invoice.total_cents === 'string' ? Number(invoice.total_cents) : invoice.total_cents,
          currency: 'usd' as const,
          status: invoice.status as 'open',
          orgName: org?.name ?? 'Unknown',
          clientName: client?.name ?? 'Unknown',
        },
        stripeClientSecret: clientSecret,
        stripePublishableKey: publishableKey,
        connectedAccountId: platform.external_account_id,
      },
    },
  };
}

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.get('/invoices/:id', publicLimiter, async (req: Request, res: Response) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const token = z.string().min(1).safeParse(req.query.token);
  if (!id.success || !token.success) {
    res.status(404).json({ error: { message: 'Not found' } });
    return;
  }
  const result = await handlePublicInvoice(id.data, token.data, defaultDeps());
  res.status(result.status).json(result.body);
});

export default router;

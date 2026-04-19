import type { Knex } from 'knex';

import { AppError } from '../middleware/error-handler';
import { isStripeTestMode } from '../utils/stripe-mode';
import {
  createInvoicePaymentIntent,
  resolveConnectedAccountId,
} from './stripe-payment-intents';

type Tdb = (table: string) => Knex.QueryBuilder;

export interface EnsurePaymentIntentDeps {
  createPaymentIntent: typeof createInvoicePaymentIntent;
}

export interface EnsuredPaymentIntent {
  paymentIntentId: string;
  clientSecret: string;
}

interface InvoiceRow {
  id: string;
  org_id: string;
  number: string | null;
  status: string;
  total_cents: string | number;
  stripe_payment_intent_id: string | null;
  stripe_client_secret: string | null;
  client_id: string;
  seeded_at: string | Date | null;
}

/**
 * Idempotently ensure an `open` invoice has a Stripe PaymentIntent.
 * Called on first view (authenticated or public) — finalize no longer
 * creates the PI inline, so the first viewer pays the Stripe round-trip.
 *
 * Uses `SELECT … FOR UPDATE` inside the caller's transaction to serialize
 * concurrent ensures on the same invoice row.
 */
export async function ensurePaymentIntent(
  invoiceId: string,
  t: Tdb,
  deps: EnsurePaymentIntentDeps = { createPaymentIntent: createInvoicePaymentIntent },
  orgId?: string
): Promise<EnsuredPaymentIntent> {
  // `orgId` is optional because the public-pay flow authenticates via
  // payment_token (not an org context). Authenticated callers pass it so the
  // query carries an explicit org filter even if RLS is misconfigured.
  const where: Record<string, unknown> = { id: invoiceId };
  if (orgId) where.org_id = orgId;
  const invoice = (await t('invoices')
    .where(where)
    .forUpdate()
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');

  if (invoice.stripe_payment_intent_id && invoice.stripe_client_secret) {
    return {
      paymentIntentId: invoice.stripe_payment_intent_id,
      clientSecret: invoice.stripe_client_secret,
    };
  }

  if (invoice.seeded_at != null && !isStripeTestMode()) {
    throw new AppError(
      503,
      'Seeded invoices require Stripe test mode',
      'SEED_REQUIRES_TEST_MODE'
    );
  }

  // Scope platforms by org_id explicitly: this fn is also called from the
  // public (unauthenticated) route on the raw db connection where RLS is
  // bypassed, so we can't rely on the tenant filter.
  const platform = (await t('platforms')
    .where({ org_id: invoice.org_id, type: 'stripe' })
    .select(
      'external_account_id',
      'credentials_encrypted',
      'credentials_iv',
      'credentials_tag'
    )
    .first()) as
    | {
        external_account_id: string | null;
        credentials_encrypted: Buffer | null;
        credentials_iv: Buffer | null;
        credentials_tag: Buffer | null;
      }
    | undefined;

  if (!platform) {
    throw new AppError(503, 'Stripe not connected for this org');
  }

  const connectedAccountId = resolveConnectedAccountId(platform);

  const client = (await t('clients')
    .where({ id: invoice.client_id, org_id: invoice.org_id })
    .select('email')
    .first()) as { email: string | null } | undefined;

  const total = typeof invoice.total_cents === 'string' ? Number(invoice.total_cents) : invoice.total_cents;

  const pi = await deps.createPaymentIntent(
    {
      id: invoice.id,
      orgId: invoice.org_id,
      number: invoice.number,
      totalCents: total,
      clientEmail: client?.email ?? null,
    },
    connectedAccountId
  );

  await t('invoices')
    .where({ id: invoiceId, org_id: invoice.org_id })
    .update({
      stripe_payment_intent_id: pi.paymentIntentId,
      stripe_client_secret: pi.clientSecret,
    });

  return { paymentIntentId: pi.paymentIntentId, clientSecret: pi.clientSecret };
}

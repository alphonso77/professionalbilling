import type Stripe from 'stripe';

import { getStripe } from '../config/stripe';
import { decrypt } from '../utils/crypto';
import { AppError } from '../middleware/error-handler';

export interface PlatformCredentialsRow {
  external_account_id: string | null;
  credentials_encrypted: Buffer | null;
  credentials_iv: Buffer | null;
  credentials_tag: Buffer | null;
}

/**
 * Pull the connected account id out of a platforms row. Prefers the plaintext
 * `external_account_id` column; falls back to decrypting the OAuth payload if
 * the column is null for any reason.
 */
export function resolveConnectedAccountId(row: PlatformCredentialsRow): string {
  if (row.external_account_id) return row.external_account_id;

  if (!row.credentials_encrypted || !row.credentials_iv || !row.credentials_tag) {
    throw new AppError(500, 'Platform credentials are missing or corrupted');
  }
  const plaintext = decrypt({
    encrypted: row.credentials_encrypted.toString('base64'),
    iv: row.credentials_iv.toString('hex'),
    tag: row.credentials_tag.toString('hex'),
  });
  const parsed = JSON.parse(plaintext) as { stripe_user_id?: string };
  if (!parsed.stripe_user_id) {
    throw new AppError(500, 'Stripe platform row is missing stripe_user_id');
  }
  return parsed.stripe_user_id;
}

export interface InvoiceForPaymentIntent {
  id: string;
  orgId: string;
  number: string | null;
  totalCents: number;
  clientEmail: string | null;
}

export interface CreatedPaymentIntent {
  paymentIntentId: string;
  clientSecret: string;
}

export interface StripePaymentIntentClient {
  paymentIntents: Pick<Stripe.Stripe['paymentIntents'], 'create' | 'cancel'>;
}

export async function createInvoicePaymentIntent(
  invoice: InvoiceForPaymentIntent,
  connectedAccountId: string,
  stripe: StripePaymentIntentClient = getStripe()
): Promise<CreatedPaymentIntent> {
  const intent = await stripe.paymentIntents.create(
    {
      amount: invoice.totalCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: invoice.number ? `Invoice ${invoice.number}` : `Invoice ${invoice.id}`,
      receipt_email: invoice.clientEmail ?? undefined,
      metadata: { invoiceId: invoice.id, orgId: invoice.orgId },
    },
    { stripeAccount: connectedAccountId }
  );
  if (!intent.client_secret) {
    throw new AppError(502, 'Stripe did not return a client_secret for the PaymentIntent');
  }
  return { paymentIntentId: intent.id, clientSecret: intent.client_secret };
}

export async function cancelInvoicePaymentIntent(
  paymentIntentId: string,
  connectedAccountId: string,
  stripe: StripePaymentIntentClient = getStripe()
): Promise<void> {
  await stripe.paymentIntents.cancel(paymentIntentId, {}, { stripeAccount: connectedAccountId });
}

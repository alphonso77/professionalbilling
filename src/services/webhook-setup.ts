import Stripe from 'stripe';
import { getStripe } from '../config/stripe';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Stripe v22 CJS typings don't re-export the full Stripe namespace on the
 * default import, so we derive types from the instance methods instead.
 */
type WebhookEndpointCreateParams = Parameters<
  Stripe.Stripe['webhookEndpoints']['create']
>[0];
type EnabledEvents = NonNullable<WebhookEndpointCreateParams>['enabled_events'];
type WebhookEndpoint = Awaited<
  ReturnType<Stripe.Stripe['webhookEndpoints']['retrieve']>
>;

const ENABLED_EVENTS: EnabledEvents = [
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.sent',
  'invoice.finalized',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

export interface WebhookSetupResult {
  action: 'created' | 'exists';
  id: string;
  url: string;
  secret?: string;
}

type WebhookEndpointWithConnect = WebhookEndpoint & { connect?: boolean };

/**
 * Idempotent: list existing Connect endpoints, reuse one matching our URL,
 * otherwise create a new one. The signing secret is only returned on creation —
 * Stripe does not expose it on subsequent reads.
 */
export async function setupStripeWebhooks(
  baseUrl: string = env.API_BASE_URL
): Promise<WebhookSetupResult> {
  const stripe = getStripe();
  const url = `${baseUrl}/api/webhooks/stripe`;

  const existing = await stripe.webhookEndpoints.list({ limit: 100 });
  // `connect` is a documented boolean on WebhookEndpoint but absent from the v22 typings —
  // cast narrowly here rather than `as any` the whole expression.
  const match = existing.data.find(
    (ep) => ep.url === url && (ep as WebhookEndpointWithConnect).connect === true
  );

  if (match) {
    logger.info('Stripe Connect webhook already exists', { id: match.id, url });
    return { action: 'exists', id: match.id, url };
  }

  const created = await stripe.webhookEndpoints.create({
    url,
    connect: true,
    enabled_events: ENABLED_EVENTS,
    description: 'professionalbilling platform webhook',
  });

  logger.info('Stripe Connect webhook created', { id: created.id, url });
  return { action: 'created', id: created.id, url, secret: created.secret ?? undefined };
}

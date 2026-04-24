import { Worker, Job } from 'bullmq';
import type { Knex } from 'knex';

import { db } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { STRIPE_EVENTS_QUEUE } from '../config/queues';
import type { StripeEventJobData } from '../config/queues';

// Events we audit + acknowledge (200 back to Stripe) but don't act on yet.
// Anything with a real handler branches above this set in `processStripeEvent`.
const NON_ACTIONABLE_EVENTS = new Set([
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.sent',
  'invoice.finalized',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'payment_intent.payment_failed',
]);

async function isAlreadyHandled(
  database: Knex,
  eventId: string
): Promise<boolean> {
  const row = await database('audit_log')
    .where({ source: 'stripe.worker', external_id: eventId })
    .whereIn('status', ['processed', 'ignored'])
    .select('id')
    .first();
  return !!row;
}

/**
 * On payment_intent.succeeded: look up the invoice by stripe_payment_intent_id
 * and mark it paid. Workers bypass RLS (raw `db`), so we can scope directly
 * via the payment intent id (globally unique in Stripe).
 */
export async function handlePaymentIntentSucceeded(
  database: Knex,
  event: {
    id: string;
    data: { object: { id?: string } };
  }
): Promise<'handled' | 'ignored'> {
  const pi = event.data.object;
  const paymentIntentId = pi?.id;
  if (!paymentIntentId) return 'ignored';

  const invoice = await database('invoices')
    .where({ stripe_payment_intent_id: paymentIntentId })
    .select('id', 'status')
    .first();

  if (!invoice) return 'ignored';
  if (invoice.status === 'paid') return 'handled';

  await database('invoices')
    .where({ id: invoice.id })
    .update({ status: 'paid', paid_at: database.fn.now() });

  return 'handled';
}

interface ChargeRefundedPayload {
  id: string;
  created: number;
  data: {
    object: {
      id?: string;
      payment_intent?: string | null;
      amount?: number;
      amount_refunded?: number;
      refunded?: boolean;
    };
    previous_attributes?: {
      amount_refunded?: number;
    };
  };
}

/**
 * On `charge.refunded`: derive the refund delta from the event's
 * `previous_attributes.amount_refunded` vs the current `charge.amount_refunded`,
 * record an `invoice_refunds` row keyed by `stripe_event_id` UNIQUE (idempotent
 * across event retries), and flip the invoice to `'refunded'` when the charge
 * is fully refunded. Partial refunds leave the invoice `'paid'`.
 *
 * Works purely from the event payload — Stripe API versions from 2023+ no
 * longer attach `charge.refunds.data` on Charge events, so we don't rely on
 * nested Refund objects and we don't round-trip back to the Stripe API.
 */
export async function handleChargeRefunded(
  database: Knex,
  event: ChargeRefundedPayload
): Promise<'handled' | 'ignored'> {
  const charge = event.data.object;
  const chargeId = charge.id;
  const paymentIntentId = charge.payment_intent ?? null;
  if (!chargeId || !paymentIntentId) return 'ignored';

  const invoice = await database('invoices')
    .where({ stripe_payment_intent_id: paymentIntentId })
    .select('id', 'org_id', 'status', 'total_cents')
    .first();
  if (!invoice) return 'ignored';

  const prev = event.data.previous_attributes?.amount_refunded ?? 0;
  const curr = charge.amount_refunded ?? 0;
  const delta = curr - prev;
  if (delta <= 0) return 'ignored';

  const fullyRefunded =
    charge.refunded === true &&
    typeof charge.amount === 'number' &&
    curr >= charge.amount;

  await database.transaction(async (trx) => {
    await trx('invoice_refunds')
      .insert({
        org_id: invoice.org_id,
        invoice_id: invoice.id,
        stripe_charge_id: chargeId,
        stripe_event_id: event.id,
        amount_cents: delta,
        reason: null,
        stripe_created_at: new Date(event.created * 1000),
      })
      .onConflict('stripe_event_id')
      .ignore();
    if (fullyRefunded && invoice.status !== 'refunded' && invoice.status !== 'void') {
      await trx('invoices').where({ id: invoice.id }).update({ status: 'refunded' });
    }
  });

  return 'handled';
}

export async function processStripeEvent(
  job: Job<StripeEventJobData>,
  database: Knex = db
): Promise<void> {
  const { eventId, eventType, accountId, orgId, payload } = job.data;

  if (await isAlreadyHandled(database, eventId)) {
    logger.info('Stripe worker: event already handled, skipping', { eventId, eventType });
    return;
  }

  try {
    let status: 'processed' | 'ignored' = 'ignored';

    if (eventType === 'payment_intent.succeeded') {
      const outcome = await handlePaymentIntentSucceeded(
        database,
        payload as unknown as { id: string; data: { object: { id?: string } } }
      );
      status = outcome === 'handled' ? 'processed' : 'ignored';
      logger.info(`Stripe worker: payment_intent.succeeded (${outcome})`, {
        eventId,
        accountId,
        orgId,
      });
    } else if (eventType === 'charge.refunded') {
      const outcome = await handleChargeRefunded(
        database,
        payload as unknown as ChargeRefundedPayload
      );
      status = outcome === 'handled' ? 'processed' : 'ignored';
      logger.info(`Stripe worker: charge.refunded (${outcome})`, {
        eventId,
        accountId,
        orgId,
      });
    } else if (NON_ACTIONABLE_EVENTS.has(eventType)) {
      logger.info(`Stripe worker: ${eventType} (non-actionable, acknowledged)`, {
        eventId,
        accountId,
        orgId,
      });
      status = 'processed';
    } else {
      logger.info('Stripe worker: unknown event type, ignoring', { eventId, eventType });
      status = 'ignored';
    }

    await database('audit_log').insert({
      source: 'stripe.worker',
      org_id: orgId,
      event_type: eventType,
      external_id: eventId,
      payload: payload as unknown as object,
      status,
    });
  } catch (err) {
    const message = (err as Error).message;
    logger.error('Stripe worker: handler failed', { err: message, eventId, eventType });
    await database('audit_log')
      .insert({
        source: 'stripe.worker',
        org_id: orgId,
        event_type: eventType,
        external_id: eventId,
        payload: payload as unknown as object,
        status: 'error',
        error_detail: message,
      })
      .catch((auditErr: unknown) => {
        logger.error('Failed to write audit log', { err: (auditErr as Error).message });
      });
    throw err;
  }
}

// Only start the BullMQ worker when this module is the process entrypoint —
// importing the module (e.g. for tests) should NOT open a Redis connection.
if (require.main === module) {
  const worker = new Worker<StripeEventJobData>(
    STRIPE_EVENTS_QUEUE,
    (job) => processStripeEvent(job),
    { connection: redis, concurrency: 5 }
  );

  worker.on('completed', (job) => {
    logger.debug('stripe-events worker completed', { eventId: job.data.eventId });
  });
  worker.on('failed', (job, err) => {
    logger.error('stripe-events worker failed', { eventId: job?.data.eventId, err: err.message });
  });
  logger.info('stripe-events worker started', { queue: STRIPE_EVENTS_QUEUE });
}

import { Worker, Job } from 'bullmq';
import type { Knex } from 'knex';

import { db } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { STRIPE_EVENTS_QUEUE } from '../config/queues';
import type { StripeEventJobData } from '../config/queues';

const KNOWN_EVENT_TYPES = new Set([
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
    } else if (KNOWN_EVENT_TYPES.has(eventType)) {
      logger.info(`Stripe worker: ${eventType} (stub)`, { eventId, accountId, orgId });
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

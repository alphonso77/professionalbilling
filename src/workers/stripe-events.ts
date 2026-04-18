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
    if (KNOWN_EVENT_TYPES.has(eventType)) {
      logger.info(`Stripe worker: ${eventType} (stub)`, { eventId, accountId, orgId });
      await database('audit_log').insert({
        source: 'stripe.worker',
        org_id: orgId,
        event_type: eventType,
        external_id: eventId,
        payload: payload as unknown as object,
        status: 'processed',
      });
    } else {
      logger.info('Stripe worker: unknown event type, ignoring', { eventId, eventType });
      await database('audit_log').insert({
        source: 'stripe.worker',
        org_id: orgId,
        event_type: eventType,
        external_id: eventId,
        payload: payload as unknown as object,
        status: 'ignored',
      });
    }
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

const worker = new Worker<StripeEventJobData>(
  STRIPE_EVENTS_QUEUE,
  (job) => processStripeEvent(job),
  {
    connection: redis,
    concurrency: 5,
  }
);

worker.on('completed', (job) => {
  logger.debug('stripe-events worker completed', { eventId: job.data.eventId });
});

worker.on('failed', (job, err) => {
  logger.error('stripe-events worker failed', { eventId: job?.data.eventId, err: err.message });
});

logger.info('stripe-events worker started', { queue: STRIPE_EVENTS_QUEUE });

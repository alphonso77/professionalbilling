import { Router, Request, Response } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';

import { db } from '../config/database';
import { env } from '../config/env';
import { getStripe } from '../config/stripe';
import { logger } from '../utils/logger';
import { registry } from '../openapi/registry';
import { getStripeEventsQueue } from '../config/queues';
import type { StripeEvent, StripeEventJobData } from '../config/queues';

const StripeEventResponse = z.object({ received: z.boolean() });

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/stripe',
  tags: ['webhooks'],
  summary: 'Stripe Connect platform webhook receiver',
  description:
    'Single endpoint registered on the platform account with connect=true. ' +
    'All connected-account events hit here; tenant is resolved via event.account → platforms.external_account_id.',
  responses: {
    200: {
      description: 'Event accepted (processed or ignored)',
      content: { 'application/json': { schema: StripeEventResponse } },
    },
    400: { description: 'Signature verification failed or missing header' },
    500: { description: 'Handler error — Stripe will retry' },
  },
});

export interface StripeEventResult {
  status: number;
  body: object;
}

export interface StripeEventQueue {
  add(
    name: string,
    data: StripeEventJobData,
    opts?: { attempts?: number; backoff?: { type: 'exponential'; delay: number } }
  ): Promise<unknown>;
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

/**
 * Pure handler — signature is already verified by the caller.
 * Fails open on missing/unknown account (returns 200 ignored) to prevent
 * Stripe from retrying orphan-account events forever.
 */
export async function handleStripeEvent(
  evt: StripeEvent,
  queue: StripeEventQueue,
  database: Knex = db
): Promise<StripeEventResult> {
  const eventId = evt.id;
  const eventType = evt.type;
  const accountId = evt.account ?? null;

  try {
    if (!accountId) {
      await database('audit_log').insert({
        source: 'stripe',
        event_type: eventType,
        external_id: eventId,
        payload: evt as unknown as object,
        status: 'ignored',
      });
      logger.info(`Stripe webhook: no event.account (platform-level), ignored`, { eventId, eventType });
      return { status: 200, body: { received: true } };
    }

    const platform = await database('platforms')
      .where({ type: 'stripe', external_account_id: accountId })
      .select('id', 'org_id')
      .first();

    if (!platform) {
      await database('audit_log').insert({
        source: 'stripe',
        event_type: eventType,
        external_id: eventId,
        payload: evt as unknown as object,
        status: 'ignored',
      });
      logger.warn(`Stripe webhook: unknown account, ignored (fail-open)`, { accountId, eventType, eventId });
      return { status: 200, body: { received: true } };
    }

    await queue.add(
      eventType,
      {
        eventId,
        eventType,
        accountId,
        orgId: platform.org_id as string,
        payload: evt,
      },
      JOB_OPTIONS
    );

    await database('audit_log').insert({
      source: 'stripe',
      org_id: platform.org_id,
      event_type: eventType,
      external_id: eventId,
      payload: evt as unknown as object,
      status: 'processed',
    });

    logger.info(`Stripe webhook enqueued`, { eventType, eventId, orgId: platform.org_id });
    return { status: 200, body: { received: true } };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(`Stripe webhook handler error`, { err: message, eventId, eventType });
    await database('audit_log')
      .insert({
        source: 'stripe',
        event_type: eventType,
        external_id: eventId,
        payload: evt as unknown as object,
        status: 'error',
        error_detail: message,
      })
      .catch((auditErr: unknown) => {
        logger.error('Failed to write audit log', { err: (auditErr as Error).message });
      });
    return { status: 500, body: { error: 'webhook_handler_failed' } };
  }
}

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('Stripe webhook called but STRIPE_WEBHOOK_SECRET is not set');
    res.status(500).json({ error: 'stripe_webhook_not_configured' });
    return;
  }

  const sig = req.headers['stripe-signature'];
  if (typeof sig !== 'string' || !sig) {
    res.status(400).json({ error: 'missing_stripe_signature' });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    logger.error(
      'Stripe webhook body is not a Buffer — express.raw must be mounted before express.json for this path',
      {
        contentType: req.headers['content-type'],
        bodyType: typeof req.body,
      }
    );
    res.status(500).json({ error: 'raw_body_not_configured' });
    return;
  }

  let evt: StripeEvent;
  try {
    evt = getStripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { err: (err as Error).message });
    res.status(400).json({ error: 'invalid_signature' });
    return;
  }

  const result = await handleStripeEvent(evt, getStripeEventsQueue());
  res.status(result.status).json(result.body);
});

export default router;

import { Router, Request, Response } from 'express';
import crypto from 'node:crypto';
import type { Knex } from 'knex';
import { z } from 'zod';

import { db } from '../config/database';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { registry } from '../openapi/registry';
import {
  provisionCustomer,
  type ProvisionCustomerInput,
  type ProvisionCustomerResult,
} from '../services/clerk-provisioning';
import { getWelcomeEmailQueue } from '../config/queues';
import type { WelcomeEmailJobData } from '../config/queues';

const SignupPayload = z.object({
  event: z.literal('signup.completed'),
  occurredAt: z.string(),
  email: z.string().email(),
  stripeCustomerId: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  trialEndAt: z.number().nullable(),
  termsAccepted: z.boolean(),
  termsAcceptedAt: z.string().datetime(),
  termsVersion: z.string().nullable(),
  termsAcceptedIp: z.string().nullable(),
});

type SignupPayload = z.infer<typeof SignupPayload>;

const SignupAccepted = z.object({ received: z.literal(true), reused: z.boolean() });

registry.registerPath({
  method: 'post',
  path: '/api/webhooks/fratelli-signup',
  tags: ['webhooks'],
  summary: 'fratellisoftware-com signup hand-off',
  description:
    'Signed webhook from the marketing site fired after Stripe checkout. ' +
    'Provisions a Clerk user + org server-side, persists Stripe metadata via ' +
    'publicMetadata (read back by the organization.created Clerk webhook), and ' +
    'enqueues a welcome email containing the /activate URL. HMAC-SHA256 signed ' +
    'over the raw body with PB_WEBHOOK_SECRET; header `X-Fratelli-Signature: sha256=<hex>`.',
  responses: {
    200: {
      description: 'Accepted (processed or already-seen replay)',
      content: { 'application/json': { schema: SignupAccepted } },
    },
    400: { description: 'Malformed payload' },
    401: { description: 'Invalid or missing signature' },
    500: { description: 'Handler error — marketing site will retry' },
  },
});

export interface FratelliSignupQueue {
  add(name: string, data: WelcomeEmailJobData): Promise<unknown>;
}

export type Provisioner = (input: ProvisionCustomerInput) => Promise<ProvisionCustomerResult>;

export interface FratelliSignupResult {
  status: number;
  body: object;
}

const AUDIT_SOURCE = 'fratelli.signup';

/**
 * Pure handler — signature is already verified by the caller.
 * Idempotent on `stripeSubscriptionId`: a replay returns 200 without
 * re-provisioning. Returns 5xx on transient failures so the marketing
 * site's retry loop kicks in.
 */
export async function handleFratelliSignup(
  payload: SignupPayload,
  queue: FratelliSignupQueue,
  database: Knex = db,
  provision: Provisioner = provisionCustomer
): Promise<FratelliSignupResult> {
  const {
    email,
    stripeCustomerId,
    stripeSubscriptionId,
    trialEndAt,
    termsAcceptedAt,
    termsVersion,
    termsAcceptedIp,
  } = payload;

  try {
    const already = await database('audit_log')
      .where({
        source: AUDIT_SOURCE,
        external_id: stripeSubscriptionId,
        status: 'processed',
      })
      .select('id')
      .first();
    if (already) {
      logger.info('fratelli-signup: duplicate (already processed)', {
        stripeSubscriptionId,
        email,
      });
      return { status: 200, body: { received: true, reused: true } };
    }

    const result = await provision({
      email,
      stripeCustomerId,
      stripeSubscriptionId,
      trialEndAt,
      termsAcceptedAt,
      termsVersion,
      termsAcceptedIp,
    });

    await queue.add('welcome-email', {
      email,
      trialEndAt,
      stripeSubscriptionId,
    });

    await database('audit_log').insert({
      source: AUDIT_SOURCE,
      event_type: 'signup.completed',
      external_id: stripeSubscriptionId,
      status: 'processed',
      payload: {
        email,
        stripeCustomerId,
        clerkUserId: result.clerkUserId,
        clerkOrgId: result.clerkOrgId,
        reused: result.reused,
      },
    });

    return { status: 200, body: { received: true, reused: result.reused } };
  } catch (err) {
    const message = (err as Error).message;
    logger.error('fratelli-signup: handler error', {
      err: message,
      stripeSubscriptionId,
      email,
    });
    await database('audit_log')
      .insert({
        source: AUDIT_SOURCE,
        event_type: 'signup.completed',
        external_id: stripeSubscriptionId,
        status: 'error',
        error_detail: message,
        payload: { email, stripeCustomerId },
      })
      .catch((auditErr: unknown) => {
        logger.error('fratelli-signup: failed to write audit row', {
          err: (auditErr as Error).message,
        });
      });
    return { status: 500, body: { error: 'webhook_handler_failed' } };
  }
}

/**
 * Verify `X-Fratelli-Signature: sha256=<hex>` against the raw body.
 * Uses timingSafeEqual; returns false on any shape mismatch.
 */
export function verifyFratelliSignature(
  rawBody: Buffer,
  header: string | undefined,
  secret: string
): boolean {
  if (!header || typeof header !== 'string') return false;
  const prefix = 'sha256=';
  if (!header.startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);

  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');

  if (provided.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(provided, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  if (!env.PB_WEBHOOK_SECRET) {
    logger.error('fratelli-signup called but PB_WEBHOOK_SECRET is not set');
    res.status(500).json({ error: 'pb_webhook_not_configured' });
    return;
  }

  if (!Buffer.isBuffer(req.body)) {
    logger.error(
      'fratelli-signup body is not a Buffer — express.raw must be mounted before express.json for this path',
      { contentType: req.headers['content-type'], bodyType: typeof req.body }
    );
    res.status(500).json({ error: 'raw_body_not_configured' });
    return;
  }

  const sig = req.headers['x-fratelli-signature'];
  const sigStr = Array.isArray(sig) ? sig[0] : sig;
  if (!verifyFratelliSignature(req.body, sigStr, env.PB_WEBHOOK_SECRET)) {
    logger.warn('fratelli-signup signature verification failed');
    res.status(401).json({ error: 'invalid_signature' });
    return;
  }

  let json: unknown;
  try {
    json = JSON.parse(req.body.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'malformed_json' });
    return;
  }

  const parsed = SignupPayload.safeParse(json);
  if (!parsed.success) {
    logger.warn('fratelli-signup payload validation failed', {
      issues: parsed.error.issues,
    });
    res.status(400).json({ error: 'invalid_payload' });
    return;
  }

  const result = await handleFratelliSignup(parsed.data, getWelcomeEmailQueue());
  res.status(result.status).json(result.body);
});

export default router;

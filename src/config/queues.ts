import { Queue } from 'bullmq';
import Stripe from 'stripe';
import { redis } from './redis';

export const STRIPE_EVENTS_QUEUE = 'stripe-events';

/**
 * The Stripe v22 CJS typings don't re-expose the Stripe namespace on the default
 * import (only `Stripe.Stripe` — the instance-type alias — is reachable), so we
 * derive the Event type from the instance method's return type.
 */
export type StripeEvent = ReturnType<Stripe.Stripe['webhooks']['constructEvent']>;

export interface StripeEventJobData {
  eventId: string;
  eventType: string;
  accountId: string;
  orgId: string;
  payload: StripeEvent;
}

let _stripeEventsQueue: Queue<StripeEventJobData> | null = null;

export function getStripeEventsQueue(): Queue<StripeEventJobData> {
  if (!_stripeEventsQueue) {
    _stripeEventsQueue = new Queue<StripeEventJobData>(STRIPE_EVENTS_QUEUE, {
      connection: redis,
    });
  }
  return _stripeEventsQueue;
}

import Stripe from 'stripe';
import { env } from './env';

let _stripe: Stripe.Stripe | null = null;

export function getStripe(): Stripe.Stripe {
  if (!_stripe) {
    if (!env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY is not set — Stripe features are unavailable.');
    }
    _stripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

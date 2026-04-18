import { env } from '../config/env';

export function isStripeTestMode(): boolean {
  const k = env.STRIPE_SECRET_KEY ?? '';
  return /^(sk|rk)_test_/.test(k);
}

import { expect } from 'chai';

import { env } from '../../../src/config/env';
import { isStripeTestMode } from '../../../src/utils/stripe-mode';

describe('utils/stripe-mode', () => {
  const original = env.STRIPE_SECRET_KEY;
  after(() => {
    env.STRIPE_SECRET_KEY = original;
  });

  it('returns true for sk_test_ prefix', () => {
    env.STRIPE_SECRET_KEY = 'sk_test_abc123';
    expect(isStripeTestMode()).to.equal(true);
  });

  it('returns true for rk_test_ prefix (restricted test keys)', () => {
    env.STRIPE_SECRET_KEY = 'rk_test_xyz';
    expect(isStripeTestMode()).to.equal(true);
  });

  it('returns false for sk_live_ prefix', () => {
    env.STRIPE_SECRET_KEY = 'sk_live_deadbeef';
    expect(isStripeTestMode()).to.equal(false);
  });

  it('returns false for rk_live_ prefix', () => {
    env.STRIPE_SECRET_KEY = 'rk_live_deadbeef';
    expect(isStripeTestMode()).to.equal(false);
  });

  it('returns false when the key is unset', () => {
    env.STRIPE_SECRET_KEY = undefined;
    expect(isStripeTestMode()).to.equal(false);
  });

  it('returns false for an empty string', () => {
    env.STRIPE_SECRET_KEY = '';
    expect(isStripeTestMode()).to.equal(false);
  });
});

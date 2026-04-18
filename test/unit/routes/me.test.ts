import { expect } from 'chai';
import { UpdateMeBody } from '../../../src/routes/me';

describe('routes/me — UpdateMeBody validation', () => {
  it('accepts an empty patch', () => {
    expect(UpdateMeBody.safeParse({}).success).to.equal(true);
  });

  it('accepts a non-negative integer default_rate_cents', () => {
    expect(UpdateMeBody.safeParse({ default_rate_cents: 0 }).success).to.equal(true);
    expect(UpdateMeBody.safeParse({ default_rate_cents: 20_000 }).success).to.equal(true);
  });

  it('accepts null to clear default_rate_cents', () => {
    expect(UpdateMeBody.safeParse({ default_rate_cents: null }).success).to.equal(true);
  });

  it('rejects negative default_rate_cents', () => {
    expect(UpdateMeBody.safeParse({ default_rate_cents: -1 }).success).to.equal(false);
  });

  it('rejects non-integer default_rate_cents', () => {
    expect(UpdateMeBody.safeParse({ default_rate_cents: 19.5 }).success).to.equal(false);
  });

  it('rejects string default_rate_cents', () => {
    expect(
      UpdateMeBody.safeParse({ default_rate_cents: '200' as unknown as number }).success
    ).to.equal(false);
  });
});

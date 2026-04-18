import { expect } from 'chai';
import { CreateClientBody, UpdateClientBody } from '../../../src/routes/clients';

describe('routes/clients — CreateClientBody validation', () => {
  it('rejects empty name', () => {
    const result = CreateClientBody.safeParse({ name: '' });
    expect(result.success).to.equal(false);
    if (!result.success) {
      expect(result.error.issues[0].path).to.deep.equal(['name']);
    }
  });

  it('accepts a minimal payload', () => {
    const result = CreateClientBody.safeParse({ name: 'Acme Corp' });
    expect(result.success).to.equal(true);
  });

  it('rejects invalid email', () => {
    const result = CreateClientBody.safeParse({ name: 'Acme', email: 'not-an-email' });
    expect(result.success).to.equal(false);
  });

  it('accepts a fully-populated payload', () => {
    const result = CreateClientBody.safeParse({
      name: 'Acme',
      email: 'billing@acme.com',
      billing_address: '1 Way',
      notes: 'Net-30',
      default_rate_cents: 20_000,
    });
    expect(result.success).to.equal(true);
  });

  it('accepts null default_rate_cents', () => {
    const result = CreateClientBody.safeParse({ name: 'Acme', default_rate_cents: null });
    expect(result.success).to.equal(true);
  });

  it('rejects negative default_rate_cents', () => {
    const result = CreateClientBody.safeParse({ name: 'Acme', default_rate_cents: -1 });
    expect(result.success).to.equal(false);
  });

  it('rejects non-integer default_rate_cents', () => {
    const result = CreateClientBody.safeParse({ name: 'Acme', default_rate_cents: 19.5 });
    expect(result.success).to.equal(false);
  });
});

describe('routes/clients — UpdateClientBody validation', () => {
  it('accepts an empty patch', () => {
    expect(UpdateClientBody.safeParse({}).success).to.equal(true);
  });

  it('accepts partial updates', () => {
    expect(UpdateClientBody.safeParse({ notes: null }).success).to.equal(true);
    expect(UpdateClientBody.safeParse({ name: 'Renamed' }).success).to.equal(true);
    expect(UpdateClientBody.safeParse({ email: null }).success).to.equal(true);
    expect(
      UpdateClientBody.safeParse({ default_rate_cents: 25_000 }).success
    ).to.equal(true);
    expect(
      UpdateClientBody.safeParse({ default_rate_cents: null }).success
    ).to.equal(true);
  });

  it('rejects empty name when provided', () => {
    const r = UpdateClientBody.safeParse({ name: '' });
    expect(r.success).to.equal(false);
  });

  it('rejects negative default_rate_cents', () => {
    const r = UpdateClientBody.safeParse({ default_rate_cents: -50 });
    expect(r.success).to.equal(false);
  });

  it('rejects invalid email when provided', () => {
    const r = UpdateClientBody.safeParse({ email: 'bogus' });
    expect(r.success).to.equal(false);
  });
});

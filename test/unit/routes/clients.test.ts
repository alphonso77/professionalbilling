import { expect } from 'chai';
import { CreateClientBody } from '../../../src/routes/clients';

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
    });
    expect(result.success).to.equal(true);
  });
});

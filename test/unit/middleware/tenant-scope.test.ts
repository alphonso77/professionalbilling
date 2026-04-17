import { expect } from 'chai';
import { runWithTenantContext, tdb, currentOrgId } from '../../../src/config/tenant-context';
import type { Knex } from 'knex';

describe('tenant-context — tdb()', () => {
  it('throws when called outside a tenant scope', () => {
    expect(() => tdb('clients')).to.throw(/outside a tenant-scoped request/);
  });

  it('returns a query-builder call when called inside a tenant scope', async () => {
    const sentinel = Symbol('qb');
    const trx = {
      tableCalledWith: null as string | null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const fakeTrx = ((tableName: string) => {
      trx.tableCalledWith = tableName;
      return sentinel;
    }) as unknown as Knex.Transaction;

    await runWithTenantContext({ orgId: 'org-1', trx: fakeTrx }, async () => {
      const qb = tdb('clients');
      expect(qb).to.equal(sentinel);
      expect(trx.tableCalledWith).to.equal('clients');
      expect(currentOrgId()).to.equal('org-1');
    });
  });

  it('currentOrgId throws outside a tenant scope', () => {
    expect(() => currentOrgId()).to.throw(/outside a tenant-scoped request/);
  });
});

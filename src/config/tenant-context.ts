import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';

export interface TenantContext {
  orgId: string;
  trx: Knex.Transaction;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

export function runWithTenantContext<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return tenantContext.run(ctx, fn);
}

export function tdb(tableName: string): Knex.QueryBuilder {
  const ctx = tenantContext.getStore();
  if (!ctx) {
    throw new Error(
      `tdb('${tableName}') called outside a tenant-scoped request. Wrap the handler in tenantScope().`
    );
  }
  return ctx.trx(tableName);
}

export function traw(sql: string, bindings?: readonly unknown[]): Knex.Raw {
  const ctx = tenantContext.getStore();
  if (!ctx) {
    throw new Error('traw() called outside a tenant-scoped request.');
  }
  return ctx.trx.raw(sql, bindings as Knex.RawBinding[]);
}

export function currentOrgId(): string {
  const ctx = tenantContext.getStore();
  if (!ctx) throw new Error('currentOrgId() called outside a tenant-scoped request.');
  return ctx.orgId;
}

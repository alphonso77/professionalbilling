import { expect } from 'chai';
import type { Knex } from 'knex';

import { UpdateAdminUserBody, AdminUserSchema, handleUpdate } from '../../../src/routes/admin';
import { AppError } from '../../../src/middleware/error-handler';
import { runWithTenantContext } from '../../../src/config/tenant-context';
import type { AuthenticatedRequest } from '../../../src/middleware/auth';

type Row = Record<string, unknown>;

function makeUsersStub(users: Row[]) {
  function query(tableName: string) {
    if (tableName !== 'users') {
      throw new Error(`Unexpected table ${tableName}`);
    }
    const conditions: Array<(r: Row) => boolean> = [];
    const negatives: Array<(r: Row) => boolean> = [];
    let selectedCols: string[] | null = null;
    let countMode = false;

    const api: any = {
      where(cond: Row) {
        conditions.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        return api;
      },
      whereNot(cond: Row) {
        negatives.push((r) => Object.entries(cond).every(([k, v]) => r[k] === v));
        return api;
      },
      select(...cols: string[]) {
        selectedCols = cols;
        return api;
      },
      orderBy(_col: string, _dir: 'asc' | 'desc' = 'asc') {
        return api;
      },
      count(_spec: Record<string, string>) {
        countMode = true;
        return api;
      },
      async first() {
        const rows = runSelect();
        if (countMode) {
          return { count: String(rows.length) };
        }
        return rows[0];
      },
      update(patch: Row) {
        const matched = runSelect();
        for (const r of matched) Object.assign(r, patch);
        return {
          async returning(_cols: string | string[]) {
            return matched;
          },
        };
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        const rows = runSelect();
        return Promise.resolve(rows).then(resolve, reject);
      },
    };

    function runSelect(): Row[] {
      let rows = users.slice();
      if (conditions.length) {
        rows = rows.filter((r) => conditions.every((c) => c(r)));
      }
      if (negatives.length) {
        rows = rows.filter((r) => !negatives.some((n) => n(r)));
      }
      if (countMode) return rows;
      if (selectedCols) {
        rows = rows.map((r) => {
          const o: Row = {};
          for (const c of selectedCols!) o[c] = r[c];
          return o;
        });
      }
      return rows;
    }

    return api;
  }

  return query as unknown as Knex.Transaction;
}

function fakeReq(body: Record<string, unknown>, id: string): AuthenticatedRequest {
  return {
    params: { id },
    body,
    org: { id: 'org_1' },
  } as unknown as AuthenticatedRequest;
}

async function runAsTenant<T>(trx: Knex.Transaction, fn: () => Promise<T>) {
  return runWithTenantContext({ orgId: 'org_1', trx }, fn);
}

describe('routes/admin — UpdateAdminUserBody validation', () => {
  it('accepts an empty patch', () => {
    expect(UpdateAdminUserBody.safeParse({}).success).to.equal(true);
  });

  it('accepts partial patches', () => {
    expect(UpdateAdminUserBody.safeParse({ is_admin: true }).success).to.equal(true);
    expect(UpdateAdminUserBody.safeParse({ easter_egg_enabled: false }).success).to.equal(true);
    expect(
      UpdateAdminUserBody.safeParse({ is_admin: false, easter_egg_enabled: true }).success
    ).to.equal(true);
  });

  it('rejects non-boolean values', () => {
    expect(
      UpdateAdminUserBody.safeParse({ is_admin: 'yes' as unknown as boolean }).success
    ).to.equal(false);
    expect(
      UpdateAdminUserBody.safeParse({
        easter_egg_enabled: 1 as unknown as boolean,
      }).success
    ).to.equal(false);
  });
});

describe('routes/admin — AdminUserSchema response shape', () => {
  it('accepts a well-formed row', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'founder@fratellisoftware.com',
      role: 'owner',
      is_admin: true,
      easter_egg_enabled: false,
      created_at: '2026-04-18T00:00:00Z',
    };
    const result = AdminUserSchema.safeParse(row);
    expect(result.success).to.equal(true);
  });

  it('allows null email', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      email: null,
      role: 'member',
      is_admin: false,
      easter_egg_enabled: false,
      created_at: '2026-04-18T00:00:00Z',
    };
    expect(AdminUserSchema.safeParse(row).success).to.equal(true);
  });
});

describe('routes/admin — handleUpdate last-admin guard', () => {
  const TARGET = '00000000-0000-0000-0000-000000000001';

  it('rejects demoting the only admin with LAST_ADMIN', async () => {
    const trx = makeUsersStub([
      { id: TARGET, org_id: 'org_1', email: 'solo@x.com', role: 'owner', is_admin: true, easter_egg_enabled: false, created_at: '2026-04-18T00:00:00Z' },
    ]);

    let caught: unknown;
    try {
      await runAsTenant(trx, () =>
        handleUpdate(fakeReq({ is_admin: false }, TARGET))
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(400);
    expect((caught as AppError).code).to.equal('LAST_ADMIN');
  });

  it('permits demoting an admin when another admin exists', async () => {
    const OTHER = '00000000-0000-0000-0000-000000000002';
    const trx = makeUsersStub([
      { id: TARGET, org_id: 'org_1', email: 'a@x.com', role: 'owner', is_admin: true, easter_egg_enabled: false, created_at: '2026-04-18T00:00:00Z' },
      { id: OTHER, org_id: 'org_1', email: 'b@x.com', role: 'admin', is_admin: true, easter_egg_enabled: false, created_at: '2026-04-18T00:00:00Z' },
    ]);

    const result = await runAsTenant(trx, () =>
      handleUpdate(fakeReq({ is_admin: false }, TARGET))
    );
    expect((result as { data: { is_admin: boolean } }).data.is_admin).to.equal(false);
  });

  it('permits toggling easter_egg_enabled without touching is_admin', async () => {
    const trx = makeUsersStub([
      { id: TARGET, org_id: 'org_1', email: 'a@x.com', role: 'owner', is_admin: true, easter_egg_enabled: false, created_at: '2026-04-18T00:00:00Z' },
    ]);

    const result = await runAsTenant(trx, () =>
      handleUpdate(fakeReq({ easter_egg_enabled: true }, TARGET))
    );
    expect((result as { data: { easter_egg_enabled: boolean; is_admin: boolean } }).data.easter_egg_enabled).to.equal(true);
    expect((result as { data: { easter_egg_enabled: boolean; is_admin: boolean } }).data.is_admin).to.equal(true);
  });

  it('returns 404 when the target user does not exist', async () => {
    const trx = makeUsersStub([]);

    let caught: unknown;
    try {
      await runAsTenant(trx, () =>
        handleUpdate(fakeReq({ is_admin: true }, TARGET))
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });
});

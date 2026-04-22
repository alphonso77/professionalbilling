import { expect } from 'chai';

import {
  createOfferCode,
  deactivateOfferCode,
  randomCode,
  redeemOfferCode,
  type OfferCodeRow,
} from '../../../src/services/offer-codes';

type Row = Record<string, unknown>;

function makeMockDb() {
  const tables: Record<string, Row[]> = {
    'corporate.offer_codes': [],
    'corporate.offer_code_redemptions': [],
  };

  function query(table: string) {
    const conds: Array<(r: Row) => boolean> = [];
    let usedForUpdate = false;

    const api: any = {
      where(c: Partial<Row>) {
        conds.push((r) => Object.entries(c).every(([k, v]) => r[k] === v));
        return api;
      },
      select(..._cols: string[]) {
        return api;
      },
      forUpdate() {
        usedForUpdate = true;
        return api;
      },
      async first() {
        return tables[table].find((r) => conds.every((f) => f(r)));
      },
      orderBy() {
        return api;
      },
      insert(payload: Row | Row[]) {
        const payloads = Array.isArray(payload) ? payload : [payload];
        // Honour UNIQUE on `code` for offer_codes
        if (table === 'corporate.offer_codes') {
          for (const p of payloads) {
            const clash = tables[table].find((r) => r.code === p.code);
            if (clash) {
              const err = new Error('duplicate key') as Error & {
                code: string;
                constraint: string;
              };
              err.code = '23505';
              err.constraint = 'offer_codes_code_unique';
              return {
                returning(..._c: string[]) {
                  return Promise.reject(err);
                },
                then: (resolve: () => void, reject: (e: unknown) => void) =>
                  reject(err),
              };
            }
          }
        }
        const inserted: Row[] = [];
        for (const p of payloads) {
          const withId = {
            id: `r${tables[table].length + 1}`,
            active: true,
            redemption_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            deactivated_at: null,
            expires_at: null,
            max_redemptions: null,
            created_by_user_id: null,
            ...p,
          };
          tables[table].push(withId);
          inserted.push(withId);
        }
        return {
          returning(..._cols: string[]) {
            return Promise.resolve(inserted);
          },
          then: (resolve: (v: unknown) => void) => resolve(undefined),
        };
      },
      update(patch: Row) {
        const matched = tables[table].filter((r) => conds.every((f) => f(r)));
        for (const r of matched) {
          for (const [k, v] of Object.entries(patch)) {
            if (v && typeof v === 'object' && 'isRaw' in (v as object)) {
              const rawText = (v as { sql: string }).sql;
              if (rawText === 'redemption_count + 1') {
                r.redemption_count = (r.redemption_count as number) + 1;
                continue;
              }
            }
            r[k] = v;
          }
        }
        const snapshot = matched.map((r) => ({ ...r }));
        return {
          returning(..._c: string[]) {
            return Promise.resolve(snapshot);
          },
          then: (resolve: (v: unknown) => void) => resolve(matched.length),
        };
      },
    };
    return api;
  }

  const fn: any = (t: string) => query(t);
  fn.raw = (sql: string) => ({ isRaw: true, sql });
  fn.fn = { now: () => new Date().toISOString() };
  fn.transaction = async (callback: (trx: unknown) => Promise<unknown>) => {
    const trxFn = (t: string) => query(t);
    (trxFn as any).raw = fn.raw;
    (trxFn as any).fn = fn.fn;
    return callback(trxFn);
  };
  fn._tables = tables;
  return fn;
}

function makeClerkStub() {
  const calls: unknown[] = [];
  const client = {
    invitations: {
      async createInvitation(params: unknown) {
        calls.push(params);
        return { id: `inv_${calls.length}` };
      },
    },
    _calls: calls,
  };
  return client;
}

describe('services/offer-codes — randomCode', () => {
  it('returns 6-digit zero-padded numeric strings', () => {
    for (let i = 0; i < 20; i++) {
      const c = randomCode();
      expect(c).to.match(/^[0-9]{6}$/);
    }
  });
});

describe('services/offer-codes — createOfferCode', () => {
  it('inserts and returns the row', async () => {
    const db = makeMockDb();
    const row = await createOfferCode(
      { max_redemptions: 5, created_by_user_id: 'u_1' },
      db,
      () => '123456'
    );
    expect(row).to.include({
      code: '123456',
      max_redemptions: 5,
      active: true,
      redemption_count: 0,
    });
    expect(db._tables['corporate.offer_codes']).to.have.length(1);
  });

  it('retries on collision and eventually succeeds', async () => {
    const db = makeMockDb();
    db._tables['corporate.offer_codes'].push({ code: '000001', id: 'existing' });
    let i = 0;
    const gen = () => (i++ === 0 ? '000001' : '999999');
    const row = await createOfferCode({}, db, gen);
    expect(row.code).to.equal('999999');
  });
});

describe('services/offer-codes — deactivateOfferCode', () => {
  it('flips active=false and returns the row', async () => {
    const db = makeMockDb();
    await createOfferCode({}, db, () => '111111');
    const stored = db._tables['corporate.offer_codes'][0] as OfferCodeRow;
    const row = await deactivateOfferCode(stored.id, db);
    expect(row?.active).to.equal(false);
    expect(row?.deactivated_at).to.not.equal(null);
  });

  it('returns null when id is missing', async () => {
    const db = makeMockDb();
    const row = await deactivateOfferCode('missing-id', db);
    expect(row).to.equal(null);
  });
});

describe('services/offer-codes — redeemOfferCode', () => {
  it('happy path: sends invite, increments counter, inserts redemption', async () => {
    const db = makeMockDb();
    await createOfferCode({ max_redemptions: 3 }, db, () => '222222');
    const clerk = makeClerkStub();

    const res = await redeemOfferCode(
      { code: '222222', email: 'User@Acme.com', ip: '1.2.3.4' },
      db,
      clerk as unknown as Parameters<typeof redeemOfferCode>[2]
    );

    expect(res.invitationId).to.equal('inv_1');
    expect(clerk._calls).to.have.length(1);
    expect(clerk._calls[0]).to.include({ emailAddress: 'user@acme.com' });

    const stored = db._tables['corporate.offer_codes'][0];
    expect(stored.redemption_count).to.equal(1);

    expect(db._tables['corporate.offer_code_redemptions']).to.have.length(1);
    expect(db._tables['corporate.offer_code_redemptions'][0]).to.include({
      email: 'user@acme.com',
      clerk_invitation_id: 'inv_1',
      ip: '1.2.3.4',
    });
  });

  it('rejects an inactive code', async () => {
    const db = makeMockDb();
    await createOfferCode({}, db, () => '333333');
    const row = db._tables['corporate.offer_codes'][0] as OfferCodeRow;
    await deactivateOfferCode(row.id, db);

    const clerk = makeClerkStub();
    try {
      await redeemOfferCode(
        { code: '333333', email: 'a@b.com', ip: null },
        db,
        clerk as unknown as Parameters<typeof redeemOfferCode>[2]
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('INVALID_CODE');
    }
    expect(clerk._calls).to.have.length(0);
  });

  it('rejects an exhausted code', async () => {
    const db = makeMockDb();
    await createOfferCode({ max_redemptions: 1 }, db, () => '444444');
    const clerk = makeClerkStub();
    await redeemOfferCode(
      { code: '444444', email: 'a@b.com', ip: null },
      db,
      clerk as unknown as Parameters<typeof redeemOfferCode>[2]
    );
    try {
      await redeemOfferCode(
        { code: '444444', email: 'c@d.com', ip: null },
        db,
        clerk as unknown as Parameters<typeof redeemOfferCode>[2]
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('INVALID_CODE');
    }
    expect(clerk._calls).to.have.length(1);
  });

  it('rejects an expired code', async () => {
    const db = makeMockDb();
    await createOfferCode(
      { expires_at: new Date(Date.now() - 60_000).toISOString() },
      db,
      () => '555555'
    );
    const clerk = makeClerkStub();
    try {
      await redeemOfferCode(
        { code: '555555', email: 'a@b.com', ip: null },
        db,
        clerk as unknown as Parameters<typeof redeemOfferCode>[2]
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('INVALID_CODE');
    }
  });

  it('rejects an unknown code', async () => {
    const db = makeMockDb();
    const clerk = makeClerkStub();
    try {
      await redeemOfferCode(
        { code: '000000', email: 'a@b.com', ip: null },
        db,
        clerk as unknown as Parameters<typeof redeemOfferCode>[2]
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).to.equal('INVALID_CODE');
    }
  });
});

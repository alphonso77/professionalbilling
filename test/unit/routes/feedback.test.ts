import { expect } from 'chai';
import type { Knex } from 'knex';

import {
  CreateFeedbackBody,
  handleList,
  handleCreate,
} from '../../../src/routes/feedback';
import {
  UpdateAdminFeedbackBody,
  AdminFeedbackSchema,
  handleFeedbackList,
  handleFeedbackUpdate,
} from '../../../src/routes/admin';
import { AppError } from '../../../src/middleware/error-handler';
import { runWithTenantContext } from '../../../src/config/tenant-context';
import type { AuthenticatedRequest } from '../../../src/middleware/auth';

type Row = Record<string, unknown>;

/** Minimal Knex-like stub that mimics `.where({...})`, `.leftJoin(...)`, `.select(...)`,
 *  `.orderBy(...)`, `.first()`, `.insert(...).returning(...)`, `.update(...)`.
 *  Used by handler-level tests to drive the logic without a live DB. */
function makeFeedbackStub(opts: {
  feedback: Row[];
  users?: Row[];
  nextId?: string;
}) {
  function query(tableName: string) {
    if (tableName !== 'feedback') {
      throw new Error(`Unexpected table ${tableName}`);
    }
    const conditions: Array<(r: Row) => boolean> = [];
    let selectedCols: string[] | null = null;
    let joinUsers = false;

    const api: any = {
      where(...args: any[]) {
        if (args.length === 2) {
          const [col, value] = args as [string, unknown];
          const key = col.includes('.') ? col.split('.').pop()! : col;
          conditions.push((r) => r[key] === value);
        } else {
          const cond = args[0] as Row;
          conditions.push((r) =>
            Object.entries(cond).every(([k, v]) => {
              const key = k.includes('.') ? k.split('.').pop()! : k;
              return r[key] === v;
            })
          );
        }
        return api;
      },
      leftJoin(table: string) {
        if (table !== 'users') throw new Error(`Unexpected join ${table}`);
        joinUsers = true;
        return api;
      },
      select(...cols: unknown[]) {
        const flat: string[] = [];
        for (const c of cols) {
          if (Array.isArray(c)) flat.push(...(c as string[]));
          else flat.push(c as string);
        }
        selectedCols = flat;
        return api;
      },
      orderBy(_col: string, _dir: 'asc' | 'desc' = 'asc') {
        return api;
      },
      async first() {
        return runSelect()[0];
      },
      insert(row: Row) {
        const id = opts.nextId ?? '00000000-0000-0000-0000-0000000000f0';
        const now = '2026-04-18T00:00:00Z';
        const inserted = {
          id,
          status: 'pending',
          admin_note: null,
          created_at: now,
          updated_at: now,
          ...row,
        };
        opts.feedback.push(inserted);
        return {
          async returning(_cols: string[]) {
            return [project(inserted, _cols)];
          },
        };
      },
      async update(patch: Row) {
        const matched = runSelect({ raw: true });
        for (const r of matched) Object.assign(r, patch);
        return matched.length;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(runSelect()).then(resolve, reject);
      },
    };

    function runSelect(flags: { raw?: boolean } = {}): Row[] {
      let rows = opts.feedback.slice();
      if (conditions.length) {
        rows = rows.filter((r) => conditions.every((c) => c(r)));
      }
      if (flags.raw) return rows;
      if (joinUsers) {
        const users = opts.users ?? [];
        rows = rows.map((r) => {
          const u = users.find((x) => x.id === r.user_id) ?? {};
          return { ...r, email: (u as Row).email ?? null };
        });
      }
      if (selectedCols) {
        const aliased = selectedCols.map((c) => {
          const m = /^([\w.]+)\s+as\s+(\w+)$/i.exec(c);
          if (m) return { src: m[1].split('.').pop()!, dst: m[2] };
          return { src: c, dst: c };
        });
        rows = rows.map((r) => {
          const o: Row = {};
          for (const { src, dst } of aliased) o[dst] = r[src];
          return o;
        });
      }
      return rows;
    }

    function project(row: Row, cols: string[]): Row {
      const out: Row = {};
      for (const c of cols) out[c] = row[c];
      return out;
    }

    return api;
  }

  return query as unknown as Knex.Transaction;
}

function fakeReq(opts: {
  userId?: string;
  orgId?: string;
  body?: Row;
  params?: Row;
}): AuthenticatedRequest {
  return {
    userId: opts.userId ?? 'user_a',
    org: { id: opts.orgId ?? 'org_1' } as { id: string; clerk_org_id: string; plan: string },
    body: opts.body ?? {},
    params: opts.params ?? {},
  } as unknown as AuthenticatedRequest;
}

async function runAs<T>(trx: Knex.Transaction, fn: () => Promise<T>) {
  return runWithTenantContext({ orgId: 'org_1', trx }, fn);
}

describe('routes/feedback — CreateFeedbackBody validation', () => {
  it('rejects invalid type', () => {
    const r = CreateFeedbackBody.safeParse({
      type: 'bogus',
      subject: 'x',
      body: 'y',
    });
    expect(r.success).to.equal(false);
  });

  it('rejects empty subject', () => {
    const r = CreateFeedbackBody.safeParse({ type: 'bug', subject: '', body: 'y' });
    expect(r.success).to.equal(false);
  });

  it('rejects empty body', () => {
    const r = CreateFeedbackBody.safeParse({ type: 'bug', subject: 'x', body: '' });
    expect(r.success).to.equal(false);
  });

  it('accepts every valid type', () => {
    for (const type of ['bug', 'feature', 'ui', 'other'] as const) {
      const r = CreateFeedbackBody.safeParse({ type, subject: 's', body: 'b' });
      expect(r.success).to.equal(true);
    }
  });
});

describe('routes/feedback — handleList filters by caller user_id', () => {
  const USER_A = '00000000-0000-0000-0000-00000000aaaa';
  const USER_B = '00000000-0000-0000-0000-00000000bbbb';

  it("returns only the caller's own rows", async () => {
    const trx = makeFeedbackStub({
      feedback: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          org_id: 'org_1',
          user_id: USER_A,
          type: 'bug',
          subject: 'A1',
          body: 'b',
          status: 'pending',
          admin_note: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
        {
          id: '00000000-0000-0000-0000-000000000002',
          org_id: 'org_1',
          user_id: USER_B,
          type: 'feature',
          subject: 'B1',
          body: 'b',
          status: 'pending',
          admin_note: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
      ],
    });

    const result = (await runAs(trx, () =>
      handleList(fakeReq({ userId: USER_A }))
    )) as { data: Row[] };

    expect(result.data).to.have.length(1);
    expect(result.data[0].subject).to.equal('A1');
    expect(result.data[0].user_id).to.equal(USER_A);
  });
});

describe('routes/feedback — handleCreate', () => {
  it('inserts with the caller user_id and returns the row', async () => {
    const USER = '00000000-0000-0000-0000-00000000aaaa';
    const trx = makeFeedbackStub({ feedback: [] });

    const result = (await runAs(trx, () =>
      handleCreate(
        fakeReq({
          userId: USER,
          body: { type: 'bug', subject: 'Login broken', body: 'Details…' },
        })
      )
    )) as { data: Row };

    expect(result.data.user_id).to.equal(USER);
    expect(result.data.org_id).to.equal('org_1');
    expect(result.data.type).to.equal('bug');
    expect(result.data.subject).to.equal('Login broken');
    expect(result.data.status).to.equal('pending');
  });

  it('rejects invalid body via zod', async () => {
    const trx = makeFeedbackStub({ feedback: [] });
    let caught: unknown;
    try {
      await runAs(trx, () =>
        handleCreate(fakeReq({ body: { type: 'not-valid', subject: 's', body: 'b' } }))
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.exist;
  });
});

describe('routes/admin — UpdateAdminFeedbackBody validation', () => {
  it('accepts an empty patch', () => {
    expect(UpdateAdminFeedbackBody.safeParse({}).success).to.equal(true);
  });

  it('accepts a status change', () => {
    expect(
      UpdateAdminFeedbackBody.safeParse({ status: 'resolved' }).success
    ).to.equal(true);
  });

  it('accepts a null admin_note (clear)', () => {
    expect(
      UpdateAdminFeedbackBody.safeParse({ admin_note: null }).success
    ).to.equal(true);
  });

  it('rejects an unknown status', () => {
    expect(
      UpdateAdminFeedbackBody.safeParse({ status: 'closed' }).success
    ).to.equal(false);
  });
});

describe('routes/admin — AdminFeedbackSchema response shape', () => {
  it('accepts a well-formed row with submitter_email', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      org_id: '00000000-0000-0000-0000-0000000000aa',
      user_id: '00000000-0000-0000-0000-0000000000bb',
      type: 'bug',
      subject: 'hi',
      body: 'body',
      status: 'pending',
      admin_note: null,
      created_at: '2026-04-18T00:00:00Z',
      updated_at: '2026-04-18T00:00:00Z',
      submitter_email: 'user@x.com',
    };
    expect(AdminFeedbackSchema.safeParse(row).success).to.equal(true);
  });
});

describe('routes/admin — handleFeedbackList joins submitter_email', () => {
  it('includes submitter_email from the users table', async () => {
    const USER = '00000000-0000-0000-0000-00000000aaaa';
    const trx = makeFeedbackStub({
      feedback: [
        {
          id: '00000000-0000-0000-0000-000000000001',
          org_id: 'org_1',
          user_id: USER,
          type: 'bug',
          subject: 'A1',
          body: 'b',
          status: 'pending',
          admin_note: null,
          created_at: '2026-04-18T00:00:00Z',
          updated_at: '2026-04-18T00:00:00Z',
        },
      ],
      users: [{ id: USER, email: 'a@x.com' }],
    });

    const result = (await runAs(trx, () => handleFeedbackList(fakeReq({})))) as { data: Row[] };
    expect(result.data).to.have.length(1);
    expect(result.data[0].submitter_email).to.equal('a@x.com');
  });
});

describe('routes/admin — handleFeedbackUpdate', () => {
  const ID = '00000000-0000-0000-0000-000000000001';
  const USER = '00000000-0000-0000-0000-00000000aaaa';

  function seed() {
    return [
      {
        id: ID,
        org_id: 'org_1',
        user_id: USER,
        type: 'bug',
        subject: 'A1',
        body: 'b',
        status: 'pending',
        admin_note: null,
        created_at: '2026-04-18T00:00:00Z',
        updated_at: '2026-04-18T00:00:00Z',
      },
    ];
  }

  it('updates status and returns the row with submitter_email', async () => {
    const feedback = seed();
    const trx = makeFeedbackStub({
      feedback,
      users: [{ id: USER, email: 'a@x.com' }],
    });

    const result = (await runAs(trx, () =>
      handleFeedbackUpdate(fakeReq({ params: { id: ID }, body: { status: 'resolved' } }))
    )) as { data: Row };

    expect(result.data.status).to.equal('resolved');
    expect(result.data.submitter_email).to.equal('a@x.com');
    expect(feedback[0].status).to.equal('resolved');
  });

  it('updates admin_note and status together', async () => {
    const feedback = seed();
    const trx = makeFeedbackStub({
      feedback,
      users: [{ id: USER, email: 'a@x.com' }],
    });

    const result = (await runAs(trx, () =>
      handleFeedbackUpdate(
        fakeReq({
          params: { id: ID },
          body: { status: 'acknowledged', admin_note: 'Looking into it' },
        })
      )
    )) as { data: Row };

    expect(result.data.status).to.equal('acknowledged');
    expect(result.data.admin_note).to.equal('Looking into it');
    expect(feedback[0].admin_note).to.equal('Looking into it');
  });

  it('returns 404 when the row is missing', async () => {
    const trx = makeFeedbackStub({ feedback: [], users: [] });

    let caught: unknown;
    try {
      await runAs(trx, () =>
        handleFeedbackUpdate(fakeReq({ params: { id: ID }, body: { status: 'resolved' } }))
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(AppError);
    expect((caught as AppError).statusCode).to.equal(404);
  });

  it('returns the existing row when the patch is empty', async () => {
    const feedback = seed();
    const trx = makeFeedbackStub({
      feedback,
      users: [{ id: USER, email: 'a@x.com' }],
    });

    const result = (await runAs(trx, () =>
      handleFeedbackUpdate(fakeReq({ params: { id: ID }, body: {} }))
    )) as { data: Row };

    expect(result.data.status).to.equal('pending');
    expect(feedback[0].status).to.equal('pending');
  });
});

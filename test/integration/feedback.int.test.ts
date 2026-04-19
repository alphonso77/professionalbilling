import { expect } from 'chai';
import crypto from 'crypto';
import knex, { Knex } from 'knex';

import { handleList, handleCreate } from '../../src/routes/feedback';
import {
  handleFeedbackList,
  handleFeedbackUpdate,
  handleAllUsersList,
} from '../../src/routes/admin';
import type { AuthenticatedRequest } from '../../src/middleware/auth';

/**
 * End-to-end coverage for the corporate.feedback table + cross-org admin path.
 *
 * Skips cleanly when DATABASE_URL isn't reachable (CI without local pg, devs
 * without Postgres). Inserts throwaway orgs/users in randomized rows and
 * tears them down in afterAll.
 *
 * What this proves:
 *   - handleCreate writes to corporate.feedback with denormalized
 *     submitter_email + org_name resolved from the caller's session.
 *   - handleList returns only the caller's own rows, regardless of org.
 *   - handleFeedbackList returns rows from every org (super-admin path).
 *   - handleFeedbackUpdate persists status + admin_note.
 *   - handleAllUsersList joins org_name across orgs.
 */

const TEST_DB_URL = process.env.DATABASE_URL;

type Row = Record<string, unknown>;

function fakeReq(userId: string, orgId: string, body: Row = {}, params: Row = {}): AuthenticatedRequest {
  return {
    userId,
    org: { id: orgId } as { id: string; clerk_org_id: string; plan: string },
    body,
    params,
  } as unknown as AuthenticatedRequest;
}

describe('corporate.feedback (real pg integration)', function () {
  this.timeout(15_000);

  let db: Knex | null = null;
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;
  const created: string[] = [];

  before(async function () {
    if (!TEST_DB_URL) this.skip();
    const candidate = knex({
      client: 'pg',
      connection: TEST_DB_URL,
      pool: { min: 0, max: 2 },
    });
    try {
      await candidate.raw('SELECT 1');
      const tableCheck = await candidate.raw(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'corporate' AND table_name = 'feedback'"
      );
      if (!tableCheck.rows.length) {
        await candidate.destroy().catch(() => {});
        // eslint-disable-next-line no-console
        console.warn('[integration] Skipping feedback.int: corporate.feedback not yet migrated');
        this.skip();
      }
    } catch (err) {
      await candidate.destroy().catch(() => {});
      // eslint-disable-next-line no-console
      console.warn(
        `[integration] Skipping feedback.int: cannot connect to DATABASE_URL (${
          (err as Error).message
        })`
      );
      this.skip();
    }
    db = candidate;

    const tag = crypto.randomBytes(4).toString('hex');
    const [orgARow] = await db('organizations')
      .insert({
        clerk_org_id: `int_test_org_a_${tag}`,
        name: `Int Test Org A ${tag}`,
      })
      .returning('id');
    const [orgBRow] = await db('organizations')
      .insert({
        clerk_org_id: `int_test_org_b_${tag}`,
        name: `Int Test Org B ${tag}`,
      })
      .returning('id');
    orgA = (orgARow as { id: string }).id;
    orgB = (orgBRow as { id: string }).id;

    const [userARow] = await db('users')
      .insert({
        clerk_user_id: `int_test_user_a_${tag}`,
        email: `a_${tag}@example.com`,
        org_id: orgA,
        role: 'owner',
      })
      .returning('id');
    const [userBRow] = await db('users')
      .insert({
        clerk_user_id: `int_test_user_b_${tag}`,
        email: `b_${tag}@example.com`,
        org_id: orgB,
        role: 'owner',
      })
      .returning('id');
    userA = (userARow as { id: string }).id;
    userB = (userBRow as { id: string }).id;
  });

  after(async function () {
    if (!db) return;
    try {
      if (created.length) {
        await db('corporate.feedback').whereIn('id', created).del();
      }
      if (userA) await db('users').where({ id: userA }).del();
      if (userB) await db('users').where({ id: userB }).del();
      if (orgA) await db('organizations').where({ id: orgA }).del();
      if (orgB) await db('organizations').where({ id: orgB }).del();
    } finally {
      await db.destroy();
    }
  });

  it('handleCreate denormalizes submitter_email + org_name on insert', async function () {
    if (!db) this.skip();
    const result = (await handleCreate(
      fakeReq(userA, orgA, {
        type: 'bug',
        subject: 'Login broken',
        body: 'Repro: clicked sign-in, page hung',
      })
    )) as { data: Row };
    created.push(result.data.id as string);

    expect(result.data.user_id).to.equal(userA);
    expect(result.data.org_id).to.equal(orgA);
    expect(result.data.submitter_email).to.match(/^a_/);
    expect((result.data.org_name as string)).to.match(/^Int Test Org A/);
    expect(result.data.type).to.equal('bug');
    expect(result.data.status).to.equal('pending');
  });

  it('handleList returns only the caller\'s rows', async function () {
    if (!db) this.skip();
    const bResult = (await handleCreate(
      fakeReq(userB, orgB, {
        type: 'feature',
        subject: 'Dark mode please',
        body: 'Tracking ticket from B',
      })
    )) as { data: Row };
    created.push(bResult.data.id as string);

    const aList = (await handleList(fakeReq(userA, orgA))) as { data: Row[] };
    const aIds = aList.data.map((r) => r.id);
    expect(aIds).to.include.members(created.filter((id) => id !== bResult.data.id));
    expect(aIds).to.not.include(bResult.data.id);

    const bList = (await handleList(fakeReq(userB, orgB))) as { data: Row[] };
    const bIds = bList.data.map((r) => r.id);
    expect(bIds).to.include(bResult.data.id);
  });

  it('handleFeedbackList (super-admin) returns rows across orgs', async function () {
    if (!db) this.skip();
    const all = (await handleFeedbackList(fakeReq(userA, orgA))) as { data: Row[] };
    const allIds = all.data.map((r) => r.id);
    for (const id of created) {
      expect(allIds).to.include(id);
    }
  });

  it('handleFeedbackUpdate persists status + admin_note', async function () {
    if (!db) this.skip();
    const target = created[0];
    const result = (await handleFeedbackUpdate(
      fakeReq(userA, orgA, { status: 'acknowledged', admin_note: 'Reproduced' }, { id: target })
    )) as { data: Row };
    expect(result.data.status).to.equal('acknowledged');
    expect(result.data.admin_note).to.equal('Reproduced');

    const reread = await db!('corporate.feedback').where({ id: target }).first();
    expect(reread.status).to.equal('acknowledged');
    expect(reread.admin_note).to.equal('Reproduced');
  });

  it('handleAllUsersList includes both seed orgs with org_name', async function () {
    if (!db) this.skip();
    const all = (await handleAllUsersList(fakeReq(userA, orgA))) as { data: Row[] };
    const aRow = all.data.find((r) => r.id === userA);
    const bRow = all.data.find((r) => r.id === userB);
    expect(aRow, 'user A in cross-org list').to.exist;
    expect(bRow, 'user B in cross-org list').to.exist;
    expect((aRow!.org_name as string)).to.match(/^Int Test Org A/);
    expect((bRow!.org_name as string)).to.match(/^Int Test Org B/);
  });
});

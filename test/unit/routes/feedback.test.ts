import { expect } from 'chai';

import { CreateFeedbackBody, FeedbackSchema } from '../../../src/routes/feedback';
import {
  UpdateAdminFeedbackBody,
  AdminFeedbackSchema,
  AllUsersRowSchema,
} from '../../../src/routes/admin';

/**
 * Validation-layer coverage for feedback routes. The handlers themselves use
 * raw `db` against `corporate.feedback` (not `tdb`), so end-to-end behaviour is
 * exercised in `test/integration/feedback.int.test.ts` against a real Postgres
 * instance — the unit tests here only assert the Zod schemas.
 */

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

describe('routes/feedback — FeedbackSchema (user-facing list)', () => {
  it('accepts a row with denormalized email + org_name', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      org_id: '00000000-0000-0000-0000-0000000000aa',
      user_id: '00000000-0000-0000-0000-0000000000bb',
      submitter_email: 'user@x.com',
      org_name: 'Acme',
      type: 'bug',
      subject: 'hi',
      body: 'body',
      status: 'pending',
      admin_note: null,
      created_at: '2026-04-19T00:00:00Z',
      updated_at: '2026-04-19T00:00:00Z',
    };
    expect(FeedbackSchema.safeParse(row).success).to.equal(true);
  });

  it('accepts a row with null org_id / user_id (post user-deletion state)', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      org_id: null,
      user_id: null,
      submitter_email: 'gone@x.com',
      org_name: 'Defunct Org',
      type: 'feature',
      subject: 'hi',
      body: 'body',
      status: 'pending',
      admin_note: null,
      created_at: '2026-04-19T00:00:00Z',
      updated_at: '2026-04-19T00:00:00Z',
    };
    expect(FeedbackSchema.safeParse(row).success).to.equal(true);
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
  it('accepts a well-formed row with submitter_email + org_name', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      org_id: '00000000-0000-0000-0000-0000000000aa',
      user_id: '00000000-0000-0000-0000-0000000000bb',
      type: 'bug',
      subject: 'hi',
      body: 'body',
      status: 'pending',
      admin_note: null,
      created_at: '2026-04-19T00:00:00Z',
      updated_at: '2026-04-19T00:00:00Z',
      submitter_email: 'user@x.com',
      org_name: 'Acme',
    };
    expect(AdminFeedbackSchema.safeParse(row).success).to.equal(true);
  });

  it('tolerates null org/user references (post-deletion preservation)', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      org_id: null,
      user_id: null,
      type: 'bug',
      subject: 'hi',
      body: 'body',
      status: 'pending',
      admin_note: null,
      created_at: '2026-04-19T00:00:00Z',
      updated_at: '2026-04-19T00:00:00Z',
      submitter_email: 'gone@x.com',
      org_name: 'Defunct',
    };
    expect(AdminFeedbackSchema.safeParse(row).success).to.equal(true);
  });
});

describe('routes/admin — AllUsersRowSchema response shape', () => {
  it('accepts a populated cross-org row', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      email: 'founder@fratellisoftware.com',
      role: 'owner',
      is_admin: true,
      is_super_admin: true,
      org_id: '00000000-0000-0000-0000-0000000000aa',
      org_name: 'Fratelli',
      created_at: '2026-04-19T00:00:00Z',
    };
    expect(AllUsersRowSchema.safeParse(row).success).to.equal(true);
  });

  it('allows null org context (orphaned user)', () => {
    const row = {
      id: '00000000-0000-0000-0000-000000000001',
      email: null,
      role: 'member',
      is_admin: false,
      is_super_admin: false,
      org_id: null,
      org_name: null,
      created_at: '2026-04-19T00:00:00Z',
    };
    expect(AllUsersRowSchema.safeParse(row).success).to.equal(true);
  });
});

import { expect } from 'chai';

import { executeAR, previewAR, shouldFireReminder } from '../../../src/services/ar-executor';

type Row = Record<string, unknown>;

interface MockDb {
  (table: string): any;
  _tables: Record<string, Row[]>;
  _seed: (table: string, row: Row) => void;
}

/**
 * In-memory Knex stub tuned for the executor's query shapes:
 *   - `t('time_entries as te').where('te.col', v).whereNotExists(fn).select(...)`
 *   - `t('invoices').where({ org_id, status }).select(...)`
 *   - `t('audit_log').where({ source, external_id, status }).first()`
 *   - `t('invoices').insert({...}).returning('*')`
 *   - `t('invoice_line_items').insert([...])`
 *   - `allocateNextNumber` → `t('invoice_sequences').where(...).forUpdate().first()` / insert / update
 *
 * whereNotExists is treated specially: for `time_entries` it excludes rows
 * whose `id` appears as `time_entry_id` on any non-void invoice line item.
 * That matches the exact semantic in executeAR.
 */
function makeMockDb(): MockDb {
  const tables: Record<string, Row[]> = {
    invoices: [],
    invoice_line_items: [],
    invoice_sequences: [],
    clients: [],
    time_entries: [],
    platforms: [],
    organizations: [],
    audit_log: [],
  };
  let idCounter = 0;

  function query(tableSpec: string) {
    const [rawTable] = tableSpec.split(' as ');
    const tableName = rawTable.trim();

    const conds: Array<(r: Row) => boolean> = [];
    let selectedCols: string[] | null = null;
    let notExistsFilter: ((r: Row) => boolean) | null = null;

    function stripAlias(col: string): string {
      return col.split('.').pop() as string;
    }

    const api: any = {
      where(cond: Row | string, op?: unknown, val?: unknown) {
        if (typeof cond === 'string') {
          const column = stripAlias(cond);
          const expectedVal = op !== undefined && val === undefined ? op : val;
          conds.push((r) => r[column] === expectedVal);
        } else {
          conds.push((r) =>
            Object.entries(cond).every(([k, v]) => r[stripAlias(k)] === v)
          );
        }
        return api;
      },
      whereNot(col: string, v: unknown) {
        const column = stripAlias(col);
        conds.push((r) => r[column] !== v);
        return api;
      },
      whereIn(col: string, values: unknown[]) {
        const column = stripAlias(col);
        conds.push((r) => values.includes(r[column]));
        return api;
      },
      whereNotNull(col: string) {
        const column = stripAlias(col);
        conds.push((r) => r[column] !== null && r[column] !== undefined);
        return api;
      },
      whereNotExists(_fn: unknown) {
        // Hard-coded for the executor's "unbilled time entries" pattern.
        // Exclude time_entries whose id appears on any non-void invoice line item.
        if (tableName === 'time_entries') {
          const billedIds = new Set<unknown>();
          for (const ili of tables.invoice_line_items) {
            const inv = tables.invoices.find((i) => i.id === ili.invoice_id);
            if (inv && inv.status !== 'void') billedIds.add(ili.time_entry_id);
          }
          notExistsFilter = (r) => !billedIds.has(r.id);
        }
        return api;
      },
      select(...cols: string[]) {
        const filtered = cols.filter((c) => c !== '*');
        selectedCols = filtered.length ? filtered : null;
        return api;
      },
      forUpdate() {
        return api;
      },
      async first() {
        const rows = runSelect();
        return rows[0];
      },
      then(resolve: (r: Row[]) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(runSelect()).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).catch(reject);
        }
      },
      insert(payload: Row | Row[]) {
        const payloads = Array.isArray(payload) ? payload : [payload];
        const inserted: Row[] = [];
        for (const p of payloads) {
          const row: Row = {
            id: p.id ?? `mock-${tableName}-${++idCounter}`,
            created_at: '2026-04-18T00:00:00Z',
            updated_at: '2026-04-18T00:00:00Z',
            ...p,
          };
          tables[tableName].push(row);
          inserted.push(row);
        }
        const q: any = {
          async returning(_col: string | string[]) {
            return inserted;
          },
          then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
            return Promise.resolve(inserted).then(resolve, reject);
          },
        };
        return q;
      },
      update(patch: Row) {
        const matched = tables[tableName].filter((r) =>
          conds.length ? conds.every((c) => c(r)) : true
        );
        for (const r of matched) Object.assign(r, patch);
        return Promise.resolve(matched.length);
      },
      async del() {
        const before = tables[tableName].length;
        tables[tableName] = tables[tableName].filter((r) =>
          !conds.every((c) => c(r))
        );
        return before - tables[tableName].length;
      },
    };

    function runSelect(): Row[] {
      let rows = tables[tableName].slice();
      if (conds.length) rows = rows.filter((r) => conds.every((c) => c(r)));
      if (notExistsFilter) rows = rows.filter(notExistsFilter);
      if (selectedCols) {
        rows = rows.map((r) => {
          const o: Row = {};
          for (const c of selectedCols!) {
            const bare = stripAlias(c);
            o[bare] = r[bare];
          }
          return o;
        });
      }
      return rows;
    }

    return api;
  }

  const fn = ((t: string) => query(t)) as MockDb;
  fn._tables = tables;
  fn._seed = (table, row) => {
    tables[table].push(row);
  };
  return fn;
}

function seedOrg(
  db: MockDb,
  orgId: string,
  arPartial: Record<string, unknown> = {}
) {
  db._seed('organizations', {
    id: orgId,
    name: 'Org',
    ar_automation_enabled: true,
    ar_scope: 'global',
    ar_run_day_of_month: 1,
    ar_approval_required: true,
    ar_reminders_enabled: false,
    ar_reminder_cadence_days: 30,
    ...arPartial,
  });
}

function seedClient(
  db: MockDb,
  id: string,
  orgId: string,
  email: string | null = 'real@customer.com',
  overrides: Record<string, unknown> = {}
) {
  db._seed('clients', {
    id,
    org_id: orgId,
    name: `Client ${id}`,
    email,
    ar_automation_enabled: null,
    ar_approval_required: null,
    ar_reminders_enabled: null,
    ar_reminder_cadence_days: null,
    ...overrides,
  });
}

function seedTimeEntry(
  db: MockDb,
  id: string,
  clientId: string,
  orgId: string,
  durationMinutes: number,
  hourlyRateCents: number | null
) {
  db._seed('time_entries', {
    id,
    org_id: orgId,
    client_id: clientId,
    description: `Work ${id}`,
    duration_minutes: durationMinutes,
    hourly_rate_cents: hourlyRateCents,
  });
}

describe('services/ar-executor — shouldFireReminder', () => {
  const cadence = 30;
  const anchor = new Date('2026-01-01T00:00:00Z');

  it('does not fire before the first cadence bucket', () => {
    const now = new Date('2026-01-29T00:00:00Z'); // day 28
    const r = shouldFireReminder(anchor, now, cadence, 0);
    expect(r.fire).to.equal(false);
    expect(r.daysSince).to.equal(28);
  });

  it('fires reminder #1 at exactly N days since anchor', () => {
    const now = new Date('2026-01-31T00:00:00Z'); // day 30
    const r = shouldFireReminder(anchor, now, cadence, 0);
    expect(r.fire).to.equal(true);
    expect(r.reminderNumber).to.equal(1);
  });

  it('does not fire again at day 31 after reminder #1 already sent', () => {
    const now = new Date('2026-02-01T00:00:00Z'); // day 31
    const r = shouldFireReminder(anchor, now, cadence, 1);
    expect(r.fire).to.equal(false);
  });

  it('fires reminder #2 at 2N days', () => {
    const now = new Date('2026-03-02T00:00:00Z'); // day 60
    const r = shouldFireReminder(anchor, now, cadence, 1);
    expect(r.fire).to.equal(true);
    expect(r.reminderNumber).to.equal(2);
  });

  it('fires reminder #3 at 3N days', () => {
    const now = new Date('2026-04-01T00:00:00Z'); // day 90
    const r = shouldFireReminder(anchor, now, cadence, 2);
    expect(r.fire).to.equal(true);
    expect(r.reminderNumber).to.equal(3);
  });

  it('catches up one reminder per run when the scheduler missed days', () => {
    // 75 days since anchor with 0 prior reminders — floor(75/30) = 2 > 0.
    // We still only return reminderNumber=1 this pass; next pass catches #2.
    const now = new Date('2026-03-17T00:00:00Z'); // day 75
    const r = shouldFireReminder(anchor, now, cadence, 0);
    expect(r.fire).to.equal(true);
    expect(r.reminderNumber).to.equal(1);
  });

  it('honors alternate cadence values (7-day)', () => {
    const now = new Date('2026-01-08T00:00:00Z'); // day 7
    const r = shouldFireReminder(anchor, now, 7, 0);
    expect(r.fire).to.equal(true);
    expect(r.reminderNumber).to.equal(1);
  });
});

describe('services/ar-executor — executeAR auto-generate + approval branches', () => {
  it('creates a draft (with auto_generated_at) when approval is required and does NOT finalize', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_automation_enabled: true,
      ar_approval_required: true,
    });
    seedClient(db, 'c1', 'org_1', 'real@customer.com');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 25_000);   // 1h @ $250 = 25000¢
    seedTimeEntry(db, 'te_2', 'c1', 'org_1', 90, 20_000);   // 1.5h @ $200 = 30000¢

    const now = new Date('2026-04-18T00:00:00Z');
    const result = await executeAR('org_1', now, {
      triggeredBy: 'run-now',
      t: (tbl) => db(tbl),
    });

    expect(result.createdDrafts).to.have.length(1);
    expect(result.finalizedSent).to.have.length(0);

    const [draft] = db._tables.invoices;
    expect(draft.status).to.equal('draft');
    expect(draft.auto_generated_at).to.be.a('string');
    expect(Number(draft.total_cents)).to.equal(55_000);
    expect(draft.number ?? null).to.equal(null);
    expect(draft.payment_token ?? null).to.equal(null);

    const lineItems = db._tables.invoice_line_items.filter(
      (li) => li.invoice_id === draft.id
    );
    expect(lineItems).to.have.length(2);
  });

  it('finalizes + enqueues send when approval is not required', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_automation_enabled: true,
      ar_approval_required: false,
    });
    seedClient(db, 'c1', 'org_1', 'real@customer.com');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 10_000);

    const enqueued: string[] = [];
    const now = new Date('2026-04-18T00:00:00Z');
    const result = await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      enqueueSend: async (id) => {
        enqueued.push(id);
      },
    });

    expect(result.createdDrafts, 'auto-sent invoices only appear under finalizedSent').to.have.length(0);
    expect(result.finalizedSent).to.have.length(1);
    expect(enqueued).to.deep.equal(result.finalizedSent);

    const [inv] = db._tables.invoices;
    expect(inv.status).to.equal('open');
    expect(inv.number).to.match(/^2026-\d{4}$/);
    expect(inv.payment_token).to.be.a('string');
  });

  it('auto-sends but demo-skips the email for example.com recipients', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_automation_enabled: true,
      ar_approval_required: false,
    });
    seedClient(db, 'c1', 'org_1', 'bill@example.com');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 10_000);

    const enqueued: string[] = [];
    const now = new Date('2026-04-18T00:00:00Z');
    await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      enqueueSend: async (id) => {
        enqueued.push(id);
      },
    });

    expect(enqueued, 'example.com must not get real email').to.have.length(0);
    const skipAudit = db._tables.audit_log.find(
      (a) => a.event_type === 'invoice.email.skipped'
    );
    expect(skipAudit).to.not.be.undefined;
    expect((skipAudit!.payload as any).reason).to.equal('example_domain');
  });

  it('skips null-rate time entries and writes a warning audit row, but still creates the draft from the billable ones', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', { ar_approval_required: true });
    seedClient(db, 'c1', 'org_1');
    seedTimeEntry(db, 'te_good', 'c1', 'org_1', 60, 10_000);
    seedTimeEntry(db, 'te_null', 'c1', 'org_1', 60, null);

    const now = new Date('2026-04-18T00:00:00Z');
    const result = await executeAR('org_1', now, {
      triggeredBy: 'run-now',
      t: (tbl) => db(tbl),
    });

    expect(result.createdDrafts).to.have.length(1);
    const [draft] = db._tables.invoices;
    expect(Number(draft.total_cents)).to.equal(10_000);

    const warning = db._tables.audit_log.find(
      (a) => a.event_type === 'ar.auto_generate.null_rate_skipped'
    );
    expect(warning).to.not.be.undefined;
    expect(warning!.status).to.equal('skipped');
  });

  it('is a no-op when the org has automation disabled', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', { ar_automation_enabled: false });
    seedClient(db, 'c1', 'org_1');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 10_000);

    const now = new Date('2026-04-18T00:00:00Z');
    const result = await executeAR('org_1', now, {
      triggeredBy: 'run-now',
      t: (tbl) => db(tbl),
    });

    expect(result.createdDrafts).to.have.length(0);
    expect(db._tables.invoices).to.have.length(0);
  });

  it('respects a per_client automation=false override', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_scope: 'per_client',
      ar_automation_enabled: true,
    });
    seedClient(db, 'c_on', 'org_1', 'a@customer.com', {
      ar_automation_enabled: true,
    });
    seedClient(db, 'c_off', 'org_1', 'b@customer.com', {
      ar_automation_enabled: false,
    });
    seedTimeEntry(db, 'te_on', 'c_on', 'org_1', 60, 10_000);
    seedTimeEntry(db, 'te_off', 'c_off', 'org_1', 60, 10_000);

    const now = new Date('2026-04-18T00:00:00Z');
    const result = await executeAR('org_1', now, {
      triggeredBy: 'run-now',
      t: (tbl) => db(tbl),
    });

    expect(result.createdDrafts).to.have.length(1);
    const [draft] = db._tables.invoices;
    expect(draft.client_id).to.equal('c_on');
  });
});

describe('services/ar-executor — idempotency guard', () => {
  it('second same-day run is a no-op (skipped=true), no additional drafts', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_automation_enabled: true,
      ar_approval_required: true,
    });
    seedClient(db, 'c1', 'org_1');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 10_000);

    const now = new Date('2026-04-18T12:00:00Z');
    const first = await executeAR('org_1', now, {
      triggeredBy: 'run-now',
      t: (tbl) => db(tbl),
    });
    expect(first.createdDrafts).to.have.length(1);
    expect(first.skipped).to.equal(undefined);

    // Seed another unbilled entry so a non-guarded re-run WOULD create a 2nd draft.
    seedTimeEntry(db, 'te_2', 'c1', 'org_1', 60, 10_000);

    const second = await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
    });
    expect(second.skipped).to.equal(true);
    expect(second.createdDrafts).to.have.length(0);
    // Only the first run's draft exists.
    expect(db._tables.invoices).to.have.length(1);
  });
});

describe('services/ar-executor — reminder firing', () => {
  function setupOpenInvoice(db: MockDb, issueDate: string, remindersSentCount = 0) {
    seedOrg(db, 'org_1', {
      ar_automation_enabled: false, // disable auto-gen so only reminder loop runs
      ar_reminders_enabled: true,
      ar_reminder_cadence_days: 30,
    });
    seedClient(db, 'c1', 'org_1', 'real@customer.com');
    db._seed('invoices', {
      id: 'inv_open',
      org_id: 'org_1',
      client_id: 'c1',
      status: 'open',
      number: '2026-0001',
      total_cents: 50_000,
      subtotal_cents: 50_000,
      issue_date: issueDate,
      seeded_at: null,
      reminders_sent_count: remindersSentCount,
      last_reminder_sent_at: null,
    });
  }

  it('fires reminder #1 at exactly cadence days past issue date', async () => {
    const db = makeMockDb();
    setupOpenInvoice(db, '2026-01-01');
    const now = new Date('2026-01-31T00:00:00Z'); // 30 days

    const calls: Array<Record<string, unknown>> = [];
    const result = await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      sendReminderFn: async (name, payload) => {
        calls.push({ name, ...payload });
      },
    });

    expect(result.remindersSent).to.deep.equal(['inv_open']);
    expect(calls).to.have.length(1);
    expect(calls[0].name).to.equal('email');
    expect(calls[0].reminderNumber).to.equal(1);

    const inv = db._tables.invoices.find((i) => i.id === 'inv_open')!;
    expect(inv.reminders_sent_count).to.equal(1);
    expect(inv.last_reminder_sent_at).to.be.a('string');
  });

  it('fires reminder #2 at 2N days when #1 was already sent', async () => {
    const db = makeMockDb();
    setupOpenInvoice(db, '2026-01-01', 1);
    const now = new Date('2026-03-02T00:00:00Z'); // 60 days

    const calls: Array<{ reminderNumber: number }> = [];
    await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      sendReminderFn: async (_n, p) => {
        calls.push({ reminderNumber: p.reminderNumber });
      },
    });

    expect(calls).to.deep.equal([{ reminderNumber: 2 }]);
  });

  it('fires reminder #3 at 3N days when #2 was already sent', async () => {
    const db = makeMockDb();
    setupOpenInvoice(db, '2026-01-01', 2);
    const now = new Date('2026-04-01T00:00:00Z'); // 90 days

    const calls: Array<{ reminderNumber: number }> = [];
    await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      sendReminderFn: async (_n, p) => {
        calls.push({ reminderNumber: p.reminderNumber });
      },
    });

    expect(calls).to.deep.equal([{ reminderNumber: 3 }]);
  });

  it('does not fire before the next cadence bucket', async () => {
    const db = makeMockDb();
    setupOpenInvoice(db, '2026-01-01', 1);
    const now = new Date('2026-02-15T00:00:00Z'); // 45 days; floor(45/30)=1, count=1 → skip

    const calls: unknown[] = [];
    const result = await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      sendReminderFn: async (_n, p) => {
        calls.push(p);
      },
    });

    expect(calls).to.have.length(0);
    expect(result.remindersSent).to.have.length(0);
  });

  it('demo-skips reminders for seeded invoices (audit row, no channel call)', async () => {
    const db = makeMockDb();
    setupOpenInvoice(db, '2026-01-01');
    // Flip to seeded after setup.
    db._tables.invoices[0].seeded_at = '2026-01-01T00:00:00Z';
    const now = new Date('2026-01-31T00:00:00Z');

    const calls: unknown[] = [];
    await executeAR('org_1', now, {
      triggeredBy: 'scheduler',
      t: (tbl) => db(tbl),
      sendReminderFn: async (_n, p) => {
        calls.push(p);
      },
    });

    expect(calls).to.have.length(0);
    const skip = db._tables.audit_log.find(
      (a) => a.event_type === 'ar.reminder.skipped'
    );
    expect(skip).to.not.be.undefined;
    expect((skip!.payload as any).reason).to.equal('seeded');
  });
});

describe('services/ar-executor — previewAR', () => {
  it('returns wouldCreate entries but writes nothing', async () => {
    const db = makeMockDb();
    seedOrg(db, 'org_1', {
      ar_automation_enabled: true,
      ar_run_day_of_month: 1,
    });
    seedClient(db, 'c1', 'org_1');
    seedTimeEntry(db, 'te_1', 'c1', 'org_1', 60, 10_000);

    const now = new Date('2026-04-18T00:00:00Z');
    const preview = await previewAR('org_1', now, (tbl) => db(tbl));

    expect(preview.asOfDate).to.equal('2026-04-18');
    expect(preview.scheduledRunDate).to.equal('2026-05-01'); // next 1st of month
    expect(preview.wouldCreate).to.have.length(1);
    expect(preview.wouldCreate[0].clientId).to.equal('c1');
    expect(preview.wouldCreate[0].totalCents).to.equal(10_000);

    // No side effects.
    expect(db._tables.invoices).to.have.length(0);
    expect(db._tables.invoice_line_items).to.have.length(0);
    expect(db._tables.audit_log).to.have.length(0);
  });
});

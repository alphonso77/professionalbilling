/**
 * Phase 2C — shared AR execution path.
 *
 * Called by both the `ar-scheduler` worker (which iterates orgs daily) and
 * the `/api/ar-settings/run-now` route. The caller is responsible for
 * providing a transactional query builder `t`:
 *   - Worker: `db.transaction(async (trx) => executeAR(orgId, now, { t: (table) => trx(table), ... }))`
 *   - Route: pass `tdb` — the tenant-scoped transaction is already open.
 *
 * A single `audit_log` row keyed `<orgId>-<YYYY-MM-DD>` guarantees
 * idempotency: the second call on the same day is a no-op regardless of
 * trigger (scheduler + Run Now land on the same guard).
 */

import type { Knex } from 'knex';

import {
  CLIENT_AR_COLUMNS,
  ORG_AR_COLUMNS,
  resolveEffective,
  type ClientArOverrides,
  type OrgArSettings,
} from './ar-settings';
import { allocateNextNumber, type InvoiceRow } from './invoices';
import { shouldSkipSend } from './demo-skip';
import { sendReminder } from './reminder-channels';
import { getInvoiceEmailQueue } from '../config/queues';
import crypto from 'node:crypto';

type Tdb = (table: string) => Knex.QueryBuilder;

type EnqueueSend = (invoiceId: string) => Promise<unknown>;
type SendReminderFn = (
  name: string,
  payload: { invoiceId: string; orgId: string; clientId: string; reminderNumber: number }
) => Promise<void>;

export interface ExecuteAROptions {
  triggeredBy: 'scheduler' | 'run-now';
  t: Tdb;
  enqueueSend?: EnqueueSend;
  sendReminderFn?: SendReminderFn;
}

export interface ExecuteARResult {
  createdDrafts: string[];
  finalizedSent: string[];
  remindersSent: string[];
  skipped?: boolean;
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Pure cadence check: do we owe this invoice another reminder?
 *
 * Rule: `floor(daysSince / cadence) > remindersSentCount`. Strictly
 * greater guarantees exactly one reminder per cadence bucket even if
 * the scheduler missed a day.
 */
export function shouldFireReminder(
  anchor: Date,
  now: Date,
  cadenceDays: number,
  remindersSentCount: number
): { fire: boolean; reminderNumber: number; daysSince: number } {
  const daysSince = Math.floor(
    (now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
  );
  const expectedBucket = Math.floor(daysSince / cadenceDays);
  if (expectedBucket <= remindersSentCount) {
    return { fire: false, reminderNumber: remindersSentCount, daysSince };
  }
  return { fire: true, reminderNumber: remindersSentCount + 1, daysSince };
}

const defaultEnqueueSend: EnqueueSend = (invoiceId) =>
  getInvoiceEmailQueue().add(
    'send',
    { invoiceId },
    { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } }
  );

export async function executeAR(
  orgId: string,
  now: Date,
  opts: ExecuteAROptions
): Promise<ExecuteARResult> {
  const { triggeredBy, t } = opts;
  const enqueueSend = opts.enqueueSend ?? defaultEnqueueSend;
  const sendReminderImpl = opts.sendReminderFn ?? sendReminder;
  const runExternalId = `${orgId}-${ymdUtc(now)}`;

  // Idempotency guard: short-circuit if we already ran today for this org.
  const existing = await t('audit_log')
    .where({ source: 'ar.run', external_id: runExternalId, status: 'completed' })
    .select('id')
    .first();
  if (existing) {
    return {
      createdDrafts: [],
      finalizedSent: [],
      remindersSent: [],
      skipped: true,
    };
  }

  const orgRow = (await t('organizations')
    .where({ id: orgId })
    .select('id', ...ORG_AR_COLUMNS)
    .first()) as (OrgArSettings & { id: string }) | undefined;
  if (!orgRow) {
    throw new Error(`executeAR: org ${orgId} not found`);
  }

  const clients = (await t('clients')
    .where({ org_id: orgId })
    .select('id', 'name', 'email', ...CLIENT_AR_COLUMNS)) as Array<{
    id: string;
    name: string;
    email: string | null;
    ar_automation_enabled: boolean | null;
    ar_approval_required: boolean | null;
    ar_reminders_enabled: boolean | null;
    ar_reminder_cadence_days: number | null;
  }>;

  const createdDrafts: string[] = [];
  const finalizedSent: string[] = [];
  const remindersSent: string[] = [];

  for (const client of clients) {
    const eff = resolveEffective(orgRow, client as ClientArOverrides);
    if (!eff.automationEnabled) continue;

    const entries = (await t('time_entries as te')
      .where('te.client_id', client.id)
      .whereNotExists(function () {
        this.select('*')
          .from('invoice_line_items as ili')
          .join('invoices as inv', 'inv.id', 'ili.invoice_id')
          .whereRaw('ili.time_entry_id = te.id')
          .whereNot('inv.status', 'void');
      })
      .select(
        'te.id',
        'te.description',
        'te.duration_minutes',
        'te.hourly_rate_cents'
      )) as Array<{
      id: string;
      description: string;
      duration_minutes: number;
      hourly_rate_cents: number | null;
    }>;

    if (entries.length === 0) continue;

    const billable = entries.filter((e) => e.hourly_rate_cents != null) as Array<{
      id: string;
      description: string;
      duration_minutes: number;
      hourly_rate_cents: number;
    }>;
    const nullRate = entries.filter((e) => e.hourly_rate_cents == null);

    if (nullRate.length > 0) {
      await t('audit_log').insert({
        source: 'ar.auto_generate',
        org_id: orgId,
        event_type: 'ar.auto_generate.null_rate_skipped',
        external_id: client.id,
        status: 'skipped',
        payload: {
          clientId: client.id,
          timeEntryIds: nullRate.map((e) => e.id),
          reason: 'null_rate',
        },
      });
    }

    if (billable.length === 0) continue;

    const lineSeeds = billable.map((e) => {
      const hours = roundHours(e.duration_minutes);
      const rate = e.hourly_rate_cents;
      return {
        time_entry_id: e.id,
        description: e.description,
        quantity_hours: hours,
        rate_cents: rate,
        amount_cents: Math.round(hours * rate),
      };
    });
    const subtotal = lineSeeds.reduce((acc, l) => acc + l.amount_cents, 0);

    if (subtotal <= 0) continue;

    const [invoice] = (await t('invoices')
      .insert({
        org_id: orgId,
        client_id: client.id,
        status: 'draft',
        subtotal_cents: subtotal,
        total_cents: subtotal,
        auto_generated_at: now.toISOString(),
      })
      .returning('*')) as InvoiceRow[];

    await t('invoice_line_items').insert(
      lineSeeds.map((l) => ({ ...l, org_id: orgId, invoice_id: invoice.id }))
    );

    await t('audit_log').insert({
      source: 'ar.auto_generate',
      org_id: orgId,
      event_type: 'ar.auto_generate.created',
      external_id: invoice.id,
      status: 'created',
      payload: {
        clientId: client.id,
        timeEntryCount: billable.length,
        subtotalCents: subtotal,
        triggeredBy,
      },
    });

    if (eff.approvalRequired) {
      // Stays in the approval queue.
      createdDrafts.push(invoice.id);
    } else {
      const year = now.getUTCFullYear();
      const number = await allocateNextNumber(orgId, year, t);
      const paymentToken = crypto.randomUUID();

      await t('invoices').where({ id: invoice.id, org_id: orgId }).update({
        status: 'open',
        number,
        issue_date: ymdUtc(now),
        payment_token: paymentToken,
      });

      const demo = shouldSkipSend({ seededAt: null, email: client.email });
      if (demo.skip) {
        await t('audit_log').insert({
          source: 'invoice.send',
          org_id: orgId,
          event_type: 'invoice.email.skipped',
          external_id: invoice.id,
          status: 'skipped',
          payload: { reason: demo.reason, to: client.email, trigger: 'ar.auto_send' },
        });
      } else {
        await enqueueSend(invoice.id);
      }

      finalizedSent.push(invoice.id);
      await t('audit_log').insert({
        source: 'ar.auto_generate',
        org_id: orgId,
        event_type: 'ar.auto_generate.finalized_sent',
        external_id: invoice.id,
        status: 'processed',
        payload: { number, demoSkipped: demo.skip, triggeredBy },
      });
    }
  }

  // 2. Reminders — iterate open invoices, fire if cadence bucket advanced.
  const openInvoices = (await t('invoices')
    .where({ org_id: orgId, status: 'open' })
    .select(
      'id',
      'client_id',
      'number',
      'issue_date',
      'seeded_at',
      'reminders_sent_count',
      'last_reminder_sent_at'
    )) as Array<{
    id: string;
    client_id: string;
    number: string | null;
    issue_date: string | Date | null;
    seeded_at: string | Date | null;
    reminders_sent_count: number;
    last_reminder_sent_at: string | Date | null;
  }>;

  const clientById = new Map(clients.map((c) => [c.id, c]));

  for (const inv of openInvoices) {
    const client = clientById.get(inv.client_id);
    if (!client) continue;
    const eff = resolveEffective(orgRow, client as ClientArOverrides);
    if (!eff.remindersEnabled) continue;

    const anchor = inv.issue_date
      ? new Date(
          typeof inv.issue_date === 'string'
            ? inv.issue_date
            : inv.issue_date.toISOString()
        )
      : null;
    if (!anchor) continue;

    const daysSince = Math.floor(
      (now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
    );
    const cadence = eff.reminderCadenceDays;
    const count = Number(inv.reminders_sent_count ?? 0);
    const expectedBucket = Math.floor(daysSince / cadence);
    if (expectedBucket <= count) continue;

    const reminderNumber = count + 1;
    const demo = shouldSkipSend({ seededAt: inv.seeded_at, email: client.email });

    if (demo.skip) {
      await t('audit_log').insert({
        source: 'ar.reminder',
        org_id: orgId,
        event_type: 'ar.reminder.skipped',
        external_id: inv.id,
        status: 'skipped',
        payload: { reason: demo.reason, to: client.email, reminderNumber },
      });
    } else {
      await sendReminderImpl('email', {
        invoiceId: inv.id,
        orgId,
        clientId: client.id,
        reminderNumber,
      });
    }

    await t('invoices').where({ id: inv.id, org_id: orgId }).update({
      reminders_sent_count: reminderNumber,
      last_reminder_sent_at: now.toISOString(),
    });
    remindersSent.push(inv.id);

    await t('audit_log').insert({
      source: 'ar.reminder',
      org_id: orgId,
      event_type: 'ar.reminder.sent',
      external_id: inv.id,
      status: 'sent',
      payload: {
        reminderNumber,
        channel: 'email',
        daysSince,
        demoSkipped: demo.skip,
        triggeredBy,
      },
    });
  }

  try {
    await t('audit_log').insert({
      source: 'ar.run',
      org_id: orgId,
      event_type: 'ar.run.completed',
      external_id: runExternalId,
      status: 'completed',
      payload: {
        createdDrafts,
        finalizedSent,
        remindersSent,
        triggeredBy,
      },
    });
  } catch (err) {
    // Concurrent scheduler firings: unique partial index on
    // audit_log(org_id, external_id) WHERE source='ar.run' collapses the
    // race to a 23505 that we treat as a no-op.
    if ((err as { code?: string }).code === '23505') {
      return { createdDrafts: [], finalizedSent: [], remindersSent: [], skipped: true };
    }
    throw err;
  }

  return { createdDrafts, finalizedSent, remindersSent };
}

/**
 * Dry-run computation: what would executeAR do right now if called?
 * Returns shape matching `GET /api/ar-settings/preview`.
 */
export interface PreviewResult {
  asOfDate: string;
  scheduledRunDate: string;
  wouldCreate: Array<{
    clientId: string;
    clientName: string;
    timeEntryCount: number;
    totalCents: number;
  }>;
  wouldRemind: Array<{
    invoiceId: string;
    invoiceNumber: string | null;
    clientName: string;
    daysPastIssue: number;
    reminderNumber: number;
  }>;
}

function nextRunDate(now: Date, runDay: number): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const thisMonth = new Date(Date.UTC(y, m, runDay));
  if (thisMonth.getTime() > now.getTime()) return thisMonth;
  return new Date(Date.UTC(y, m + 1, runDay));
}

export async function previewAR(
  orgId: string,
  now: Date,
  t: Tdb
): Promise<PreviewResult> {
  const orgRow = (await t('organizations')
    .where({ id: orgId })
    .select('id', ...ORG_AR_COLUMNS)
    .first()) as (OrgArSettings & { id: string }) | undefined;
  if (!orgRow) {
    throw new Error(`previewAR: org ${orgId} not found`);
  }

  const clients = (await t('clients')
    .where({ org_id: orgId })
    .select('id', 'name', 'email', ...CLIENT_AR_COLUMNS)) as Array<{
    id: string;
    name: string;
    email: string | null;
    ar_automation_enabled: boolean | null;
    ar_approval_required: boolean | null;
    ar_reminders_enabled: boolean | null;
    ar_reminder_cadence_days: number | null;
  }>;

  const wouldCreate: PreviewResult['wouldCreate'] = [];
  for (const client of clients) {
    const eff = resolveEffective(orgRow, client as ClientArOverrides);
    if (!eff.automationEnabled) continue;

    const entries = (await t('time_entries as te')
      .where('te.client_id', client.id)
      .whereNotExists(function () {
        this.select('*')
          .from('invoice_line_items as ili')
          .join('invoices as inv', 'inv.id', 'ili.invoice_id')
          .whereRaw('ili.time_entry_id = te.id')
          .whereNot('inv.status', 'void');
      })
      .select('te.duration_minutes', 'te.hourly_rate_cents')) as Array<{
      duration_minutes: number;
      hourly_rate_cents: number | null;
    }>;

    const billable = entries.filter((e) => e.hourly_rate_cents != null);
    if (billable.length === 0) continue;

    const totalCents = billable.reduce((acc, e) => {
      const hours = roundHours(e.duration_minutes);
      return acc + Math.round(hours * (e.hourly_rate_cents as number));
    }, 0);
    if (totalCents <= 0) continue;

    wouldCreate.push({
      clientId: client.id,
      clientName: client.name,
      timeEntryCount: billable.length,
      totalCents,
    });
  }

  const openInvoices = (await t('invoices')
    .where({ org_id: orgId, status: 'open' })
    .select(
      'id',
      'client_id',
      'number',
      'issue_date',
      'reminders_sent_count'
    )) as Array<{
    id: string;
    client_id: string;
    number: string | null;
    issue_date: string | Date | null;
    reminders_sent_count: number;
  }>;

  const wouldRemind: PreviewResult['wouldRemind'] = [];
  const clientById = new Map(clients.map((c) => [c.id, c]));
  for (const inv of openInvoices) {
    const client = clientById.get(inv.client_id);
    if (!client) continue;
    const eff = resolveEffective(orgRow, client as ClientArOverrides);
    if (!eff.remindersEnabled) continue;
    if (!inv.issue_date) continue;

    const anchor = new Date(
      typeof inv.issue_date === 'string'
        ? inv.issue_date
        : inv.issue_date.toISOString()
    );
    const daysSince = Math.floor(
      (now.getTime() - anchor.getTime()) / (1000 * 60 * 60 * 24)
    );
    const cadence = eff.reminderCadenceDays;
    const count = Number(inv.reminders_sent_count ?? 0);
    if (Math.floor(daysSince / cadence) <= count) continue;

    wouldRemind.push({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      clientName: client.name,
      daysPastIssue: daysSince,
      reminderNumber: count + 1,
    });
  }

  return {
    asOfDate: ymdUtc(now),
    scheduledRunDate: ymdUtc(nextRunDate(now, Number(orgRow.ar_run_day_of_month))),
    wouldCreate,
    wouldRemind,
  };
}

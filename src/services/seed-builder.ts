import crypto from 'node:crypto';
import type { Knex } from 'knex';

import { allocateNextNumber } from './invoices';

type Tdb = (table: string) => Knex.QueryBuilder;

export interface SeedSummary {
  clients: number;
  time_entries: number;
  invoices: number;
  adopted: number;
}

interface ClientSpec {
  name: string;
  email: string;
  billing_address: string;
  default_rate_cents: number;
  entryCount: number;
  billed: boolean;
}

const CLIENT_SPECS: ClientSpec[] = [
  {
    name: 'Acme Corp',
    email: 'ap@acme-corp.example',
    billing_address: '500 Terry Francois Blvd, Springfield, IL',
    default_rate_cents: 35000,
    entryCount: 12,
    billed: true,
  },
  {
    name: 'Globex Industries',
    email: 'accounts@globex.example',
    billing_address: '1200 Lakeside Dr, Rochester, NY',
    default_rate_cents: 28000,
    entryCount: 9,
    billed: true,
  },
  {
    name: 'Initech LLC',
    email: 'billing@initech.example',
    billing_address: '4120 Freedom Parkway, Austin, TX',
    default_rate_cents: 22000,
    entryCount: 15,
    billed: true,
  },
  {
    name: 'Wonka Industries',
    email: 'ar@wonka.example',
    billing_address: '1 Chocolate Way, Reading, PA',
    default_rate_cents: 18500,
    entryCount: 8,
    billed: false,
  },
];

const WORK_DESCRIPTIONS = [
  'Contract review',
  'Phone consultation',
  'Document drafting',
  'Case strategy meeting',
  'Research — jurisdictional analysis',
  'Deposition prep',
  'Vendor agreement redlining',
  'Email correspondence with opposing counsel',
  'Court filing preparation',
  'Client intake interview',
  'Settlement negotiation',
  'Witness interview',
];

const DURATION_CHOICES = [15, 30, 45, 60, 75, 90, 120, 150, 180];

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * Populate a realistic demo dataset (clients + time entries + invoices)
 * in the caller's org. Every row is flagged with `seeded_at = NOW()` so
 * `DELETE /api/seed` can precisely undo.
 *
 * NO Stripe API calls here — invoices are left with `stripe_payment_intent_id
 * = NULL` and the lazy PI flow creates the PaymentIntent on first view.
 */
export async function run(orgId: string, t: Tdb): Promise<SeedSummary> {
  const rng = mulberry32(
    Number(BigInt('0x' + crypto.createHash('md5').update(orgId).digest('hex').slice(0, 8)))
  );
  const now = new Date();
  const nowIso = now.toISOString();

  let clientCount = 0;
  let entryCount = 0;
  let invoiceCount = 0;

  for (const spec of CLIENT_SPECS) {
    const [client] = (await t('clients')
      .insert({
        org_id: orgId,
        name: spec.name,
        email: spec.email,
        billing_address: spec.billing_address,
        notes: 'Demo client — created by the seed tool',
        default_rate_cents: spec.default_rate_cents,
        seeded_at: nowIso,
      })
      .returning('id')) as Array<{ id: string }>;
    clientCount += 1;

    const entryRows: Array<{
      id?: string;
      org_id: string;
      client_id: string;
      description: string;
      started_at: string;
      ended_at: string;
      duration_minutes: number;
      hourly_rate_cents: number;
      seeded_at: string;
    }> = [];
    for (let i = 0; i < spec.entryCount; i++) {
      const daysAgo = Math.floor(rng() * 30);
      const started = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
      started.setUTCHours(9 + Math.floor(rng() * 8), 0, 0, 0);
      const duration = pick(DURATION_CHOICES, rng);
      const ended = new Date(started.getTime() + duration * 60 * 1000);
      entryRows.push({
        org_id: orgId,
        client_id: client.id,
        description: pick(WORK_DESCRIPTIONS, rng),
        started_at: started.toISOString(),
        ended_at: ended.toISOString(),
        duration_minutes: duration,
        hourly_rate_cents: spec.default_rate_cents,
        seeded_at: nowIso,
      });
    }
    const inserted = (await t('time_entries')
      .insert(entryRows)
      .returning(['id', 'duration_minutes', 'description', 'hourly_rate_cents'])) as Array<{
      id: string;
      duration_minutes: number;
      description: string;
      hourly_rate_cents: number;
    }>;
    entryCount += inserted.length;

    if (!spec.billed) continue;

    // Bill roughly 2/3 of this client's entries on a single invoice.
    const toBill = inserted.slice(0, Math.max(1, Math.floor(inserted.length * 0.67)));
    const lineSeeds = toBill.map((e) => {
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

    const issueDate = new Date(now.getTime() - Math.floor(rng() * 10) * 24 * 60 * 60 * 1000);
    const dueDate = new Date(issueDate.getTime() + 15 * 24 * 60 * 60 * 1000);
    const year = issueDate.getUTCFullYear();
    const number = await allocateNextNumber(orgId, year, t);
    const paymentToken = crypto.randomUUID();

    const [invoice] = (await t('invoices')
      .insert({
        org_id: orgId,
        client_id: client.id,
        status: 'open',
        number,
        issue_date: issueDate.toISOString().slice(0, 10),
        due_date: dueDate.toISOString().slice(0, 10),
        subtotal_cents: subtotal,
        total_cents: subtotal,
        notes: 'Demo invoice — seeded',
        payment_token: paymentToken,
        seeded_at: nowIso,
      })
      .returning('id')) as Array<{ id: string }>;

    await t('invoice_line_items').insert(
      lineSeeds.map((l) => ({ ...l, org_id: orgId, invoice_id: invoice.id }))
    );
    invoiceCount += 1;
  }

  return {
    clients: clientCount,
    time_entries: entryCount,
    invoices: invoiceCount,
    adopted: 0,
  };
}

/**
 * Delete seeded rows (seeded_at IS NOT NULL) in the caller's org. If a
 * seeded client still has any non-seeded invoice or time_entry pointing at
 * it (the user booked real work against a demo client), adopt the client
 * instead of deleting — clear seeded_at so it becomes a normal row.
 *
 * Note: a subsequent POST /api/seed will re-insert a fresh "Acme Corp"
 * alongside any adopted one (no unique constraint on clients.name). v1
 * caveat — the user can delete the duplicate manually.
 */
export async function removeSeeded(orgId: string, t: Tdb): Promise<SeedSummary> {
  // Capture which years the seeded invoices span BEFORE deleting — we need
  // this to reset the per-year sequence counter so real invoices don't
  // inherit gaps left by the seed's consumed numbers.
  const seededInvoices = (await t('invoices')
    .where({ org_id: orgId })
    .whereNotNull('seeded_at')
    .select('id', 'number')) as Array<{ id: string; number: string | null }>;
  const affectedYears = new Set<number>();
  const seededInvoiceIds: string[] = [];
  for (const { id, number } of seededInvoices) {
    seededInvoiceIds.push(id);
    const m = number?.match(/^(\d{4})-\d+$/);
    if (m) affectedYears.add(Number(m[1]));
  }

  const invoices = (await t('invoices')
    .where({ org_id: orgId })
    .whereNotNull('seeded_at')
    .del()) as unknown as number;
  const timeEntries = (await t('time_entries')
    .where({ org_id: orgId })
    .whereNotNull('seeded_at')
    .del()) as unknown as number;

  // Purge audit_log rows that reference the now-deleted invoices. Sources
  // scoped to invoice IDs (external_id = invoice.id): invoice.send,
  // invoice-email. stripe.worker keys by event id, so it's intentionally
  // left alone.
  if (seededInvoiceIds.length > 0) {
    await t('audit_log')
      .where({ org_id: orgId })
      .whereIn('source', ['invoice.send', 'invoice-email'])
      .whereIn('external_id', seededInvoiceIds)
      .del();
  }

  if (affectedYears.size > 0) {
    const remaining = (await t('invoices')
      .where({ org_id: orgId })
      .whereNotNull('number')
      .select('number')) as Array<{ number: string | null }>;
    for (const year of affectedYears) {
      let maxSeq = 0;
      for (const { number } of remaining) {
        const m = number?.match(/^(\d{4})-(\d+)$/);
        if (m && Number(m[1]) === year) {
          const n = Number(m[2]);
          if (n > maxSeq) maxSeq = n;
        }
      }
      await t('invoice_sequences')
        .where({ org_id: orgId, year })
        .update({ next_seq: maxSeq + 1 });
    }
  }

  const seededClients = (await t('clients')
    .where({ org_id: orgId })
    .whereNotNull('seeded_at')
    .select('id')) as Array<{ id: string }>;

  const ids = seededClients.map((c) => c.id);
  const adoptedSet = new Set<string>();
  if (ids.length) {
    const invRefs = (await t('invoices')
      .whereIn('client_id', ids)
      .distinct('client_id')) as Array<{ client_id: string }>;
    for (const r of invRefs) adoptedSet.add(r.client_id);

    const teRefs = (await t('time_entries')
      .whereIn('client_id', ids)
      .distinct('client_id')) as Array<{ client_id: string }>;
    for (const r of teRefs) adoptedSet.add(r.client_id);
  }

  const toAdopt = ids.filter((id) => adoptedSet.has(id));
  const toDelete = ids.filter((id) => !adoptedSet.has(id));

  if (toAdopt.length) {
    await t('clients').whereIn('id', toAdopt).update({ seeded_at: null });
  }
  const clients = toDelete.length
    ? ((await t('clients').whereIn('id', toDelete).del()) as unknown as number)
    : 0;

  return {
    clients: Number(clients) || 0,
    time_entries: Number(timeEntries) || 0,
    invoices: Number(invoices) || 0,
    adopted: toAdopt.length,
  };
}

export async function hasSeededData(orgId: string, t: Tdb): Promise<boolean> {
  const existsInTable = async (table: string) => {
    const row = (await t(table)
      .where({ org_id: orgId })
      .whereNotNull('seeded_at')
      .select('id')
      .first()) as { id: string } | undefined;
    return !!row;
  };
  if (await existsInTable('clients')) return true;
  if (await existsInTable('time_entries')) return true;
  if (await existsInTable('invoices')) return true;
  return false;
}

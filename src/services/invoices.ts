import crypto from 'node:crypto';
import type { Knex } from 'knex';

import { tdb, currentOrgId } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { resolveConnectedAccountId } from './stripe-payment-intents';

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void';

export interface InvoiceRow {
  id: string;
  org_id: string;
  client_id: string;
  number: string | null;
  status: InvoiceStatus;
  issue_date: string | Date | null;
  due_date: string | Date | null;
  subtotal_cents: string | number;
  total_cents: string | number;
  notes: string | null;
  stripe_payment_intent_id: string | null;
  stripe_client_secret: string | null;
  payment_token: string | null;
  seeded_at: string | Date | null;
  paid_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface LineItemRow {
  id: string;
  org_id: string;
  invoice_id: string;
  time_entry_id: string | null;
  description: string;
  quantity_hours: string | number;
  rate_cents: string | number;
  amount_cents: string | number;
  created_at: string | Date;
}

type Tdb = (table: string) => Knex.QueryBuilder;

export interface CreateDraftInput {
  clientId: string;
  timeEntryIds: string[];
  dueDate?: string | null;
  notes?: string | null;
}

export interface UpdateDraftInput {
  dueDate?: string | null;
  notes?: string | null;
  removeLineItemIds?: string[];
}

function toIso(v: string | Date | null): string | null {
  if (v == null) return null;
  return v instanceof Date ? v.toISOString() : v;
}
function toIsoDate(v: string | Date | null): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return v;
}
function toNum(v: string | number): number {
  return typeof v === 'string' ? Number(v) : v;
}

export function serializeInvoice(row: InvoiceRow) {
  return {
    id: row.id,
    orgId: row.org_id,
    clientId: row.client_id,
    number: row.number,
    status: row.status,
    issueDate: toIsoDate(row.issue_date),
    dueDate: toIsoDate(row.due_date),
    subtotalCents: toNum(row.subtotal_cents),
    totalCents: toNum(row.total_cents),
    notes: row.notes,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeClientSecret: row.stripe_client_secret,
    paidAt: toIso(row.paid_at),
    createdAt: toIso(row.created_at) as string,
    updatedAt: toIso(row.updated_at) as string,
  };
}

export function serializeLineItem(row: LineItemRow) {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    timeEntryId: row.time_entry_id,
    description: row.description,
    quantityHours: toNum(row.quantity_hours),
    rateCents: toNum(row.rate_cents),
    amountCents: toNum(row.amount_cents),
    createdAt: toIso(row.created_at) as string,
  };
}

/** Strip credentials from list responses (and any other non-detail surface). */
export function serializeInvoiceForList(row: InvoiceRow) {
  const s = serializeInvoice(row);
  s.stripeClientSecret = null;
  return s;
}

function roundHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

function computeLineAmountCents(quantityHours: number, rateCents: number): number {
  return Math.round(quantityHours * rateCents);
}

export async function listInvoices(
  filters: {
    status?: InvoiceStatus;
    clientId?: string;
    pendingApproval?: boolean;
  },
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const qb = t('invoices')
    .where({ org_id: orgId })
    .select('*')
    .orderBy('created_at', 'desc');
  if (filters.pendingApproval) {
    qb.where({ status: 'draft' }).whereNotNull('auto_generated_at');
  } else {
    if (filters.status) qb.where({ status: filters.status });
  }
  if (filters.clientId) qb.where({ client_id: filters.clientId });
  const rows = (await qb) as InvoiceRow[];
  return rows.map(serializeInvoiceForList);
}

export async function getInvoiceWithItems(
  id: string,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  const items = (await t('invoice_line_items')
    .where({ invoice_id: id, org_id: orgId })
    .orderBy('created_at', 'asc')) as LineItemRow[];
  const client = (await t('clients')
    .where({ id: invoice.client_id, org_id: orgId })
    .select('id', 'name', 'email')
    .first()) as { id: string; name: string; email: string | null } | undefined;
  return {
    invoice,
    items,
    client: client ?? { id: invoice.client_id, name: 'Unknown', email: null },
  };
}

export async function createDraft(
  input: CreateDraftInput,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const client = await t('clients').where({ id: input.clientId, org_id: orgId }).first();
  if (!client) throw new AppError(400, 'Client not found in this org');

  if (!input.timeEntryIds.length) {
    throw new AppError(400, 'At least one time entry is required');
  }

  const entries = (await t('time_entries')
    .whereIn('id', input.timeEntryIds)
    .where({ org_id: orgId })
    .select('*')) as Array<{
    id: string;
    client_id: string | null;
    description: string;
    duration_minutes: number;
    hourly_rate_cents: number | null;
  }>;

  if (entries.length !== input.timeEntryIds.length) {
    throw new AppError(400, 'One or more time entries not found in this org');
  }

  const wrongClient = entries.filter((e) => e.client_id !== input.clientId);
  if (wrongClient.length) {
    throw new AppError(
      400,
      `Time entries do not belong to the given client: ${wrongClient.map((e) => e.id).join(', ')}`
    );
  }

  const billed = (await t('invoice_line_items')
    .whereIn('invoice_line_items.time_entry_id', input.timeEntryIds)
    .where('invoice_line_items.org_id', orgId)
    .join('invoices', 'invoices.id', 'invoice_line_items.invoice_id')
    .where('invoices.org_id', orgId)
    .whereNot('invoices.status', 'void')
    .select('invoice_line_items.time_entry_id as time_entry_id')) as Array<{
    time_entry_id: string;
  }>;
  if (billed.length) {
    throw new AppError(
      400,
      `Time entries already billed: ${billed.map((b) => b.time_entry_id).join(', ')}`
    );
  }

  const lineSeeds = entries.map((e) => {
    const hours = roundHours(e.duration_minutes);
    const rate = e.hourly_rate_cents ?? 0;
    return {
      time_entry_id: e.id,
      description: e.description,
      quantity_hours: hours,
      rate_cents: rate,
      amount_cents: computeLineAmountCents(hours, rate),
    };
  });

  const subtotal = lineSeeds.reduce((acc, l) => acc + l.amount_cents, 0);

  const [inserted] = (await t('invoices')
    .insert({
      org_id: orgId,
      client_id: input.clientId,
      status: 'draft',
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
      subtotal_cents: subtotal,
      total_cents: subtotal,
    })
    .returning('*')) as InvoiceRow[];

  if (lineSeeds.length) {
    await t('invoice_line_items').insert(
      lineSeeds.map((l) => ({ ...l, org_id: orgId, invoice_id: inserted.id }))
    );
  }

  return getInvoiceWithItems(inserted.id, orgId, t);
}

export async function updateDraft(
  id: string,
  input: UpdateDraftInput,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status !== 'draft') {
    throw new AppError(409, 'Only draft invoices can be edited');
  }

  if (input.removeLineItemIds?.length) {
    await t('invoice_line_items')
      .where({ invoice_id: id, org_id: orgId })
      .whereIn('id', input.removeLineItemIds)
      .del();
  }

  const remaining = (await t('invoice_line_items')
    .where({ invoice_id: id, org_id: orgId })
    .select('amount_cents')) as Array<{ amount_cents: string | number }>;
  const subtotal = remaining.reduce((acc, r) => acc + toNum(r.amount_cents), 0);

  const patch: Record<string, unknown> = {
    subtotal_cents: subtotal,
    total_cents: subtotal,
  };
  if (input.dueDate !== undefined) patch.due_date = input.dueDate;
  if (input.notes !== undefined) patch.notes = input.notes;

  await t('invoices').where({ id, org_id: orgId }).update(patch);
  return getInvoiceWithItems(id, orgId, t);
}

export async function deleteDraft(
  id: string,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status !== 'draft') {
    throw new AppError(409, 'Only draft invoices can be deleted');
  }
  await t('invoices').where({ id, org_id: orgId }).del();
  return { id };
}

/**
 * Atomically claim the next invoice number for (org, year).
 * Must be called inside the same tenant transaction as the invoice update.
 */
export async function allocateNextNumber(
  orgId: string,
  year: number,
  t: Tdb = tdb
): Promise<string> {
  const existing = await t('invoice_sequences')
    .where({ org_id: orgId, year })
    .forUpdate()
    .first();

  let seq: number;
  if (!existing) {
    await t('invoice_sequences').insert({ org_id: orgId, year, next_seq: 2 });
    seq = 1;
  } else {
    seq = Number(existing.next_seq);
    await t('invoice_sequences')
      .where({ org_id: orgId, year })
      .update({ next_seq: seq + 1 });
  }
  return `${year}-${String(seq).padStart(4, '0')}`;
}

export async function finalizeInvoice(
  id: string,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status !== 'draft') {
    throw new AppError(409, 'Only draft invoices can be finalized');
  }
  if (toNum(invoice.total_cents) <= 0) {
    throw new AppError(400, 'Invoice total must be greater than zero to finalize');
  }

  const issueDate = new Date();
  const year = issueDate.getUTCFullYear();
  const number = await allocateNextNumber(orgId, year, t);

  const paymentToken = crypto.randomUUID();

  await t('invoices').where({ id, org_id: orgId }).update({
    status: 'open',
    number,
    issue_date: issueDate.toISOString().slice(0, 10),
    payment_token: paymentToken,
  });

  return getInvoiceWithItems(id, orgId, t);
}

export interface VoidDeps {
  cancelPaymentIntent: (piId: string, accountId: string) => Promise<void>;
}

export async function voidInvoice(
  id: string,
  orgId: string = currentOrgId(),
  t: Tdb = tdb,
  deps: VoidDeps = {
    cancelPaymentIntent: async (piId, acct) => {
      const { cancelInvoicePaymentIntent } = await import('./stripe-payment-intents');
      try {
        await cancelInvoicePaymentIntent(piId, acct);
      } catch (err) {
        // Already-captured / already-canceled PIs throw; ignore per contract.
        // eslint-disable-next-line no-console
        console.warn('stripe cancel failed during void (ignored):', (err as Error).message);
      }
    },
  }
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status === 'paid') {
    throw new AppError(409, 'Paid invoices cannot be voided');
  }
  if (invoice.status === 'void') {
    return serializeInvoice(invoice);
  }

  if (invoice.stripe_payment_intent_id) {
    const platform = (await t('platforms')
      .where({ type: 'stripe', org_id: orgId })
      .select(
        'external_account_id',
        'credentials_encrypted',
        'credentials_iv',
        'credentials_tag'
      )
      .first()) as
      | {
          external_account_id: string | null;
          credentials_encrypted: Buffer | null;
          credentials_iv: Buffer | null;
          credentials_tag: Buffer | null;
        }
      | undefined;
    if (platform) {
      const acct = resolveConnectedAccountId(platform);
      await deps.cancelPaymentIntent(invoice.stripe_payment_intent_id, acct);
    }
  }

  const [updated] = (await t('invoices')
    .where({ id, org_id: orgId })
    .update({ status: 'void' })
    .returning('*')) as InvoiceRow[];
  return serializeInvoice(updated);
}

export async function assertInvoiceSendable(
  id: string,
  orgId: string = currentOrgId(),
  t: Tdb = tdb
) {
  const invoice = (await t('invoices')
    .where({ id, org_id: orgId })
    .first()) as InvoiceRow | undefined;
  if (!invoice) throw new AppError(404, 'Invoice not found');
  if (invoice.status !== 'open') {
    throw new AppError(409, 'Only open invoices can be sent');
  }
  return serializeInvoice(invoice);
}

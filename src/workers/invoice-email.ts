import { Worker, Job } from 'bullmq';
import { Resend } from 'resend';
import type { Knex } from 'knex';

import { db } from '../config/database';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { INVOICE_EMAIL_QUEUE } from '../config/queues';
import type { InvoiceEmailJobData } from '../config/queues';

interface InvoiceRow {
  id: string;
  org_id: string;
  client_id: string;
  number: string | null;
  total_cents: string | number;
  due_date: string | Date | null;
  payment_token: string | null;
  status: string;
}

interface ClientRow {
  name: string;
  email: string | null;
}

interface OrgRow {
  name: string;
}

export interface EmailSender {
  send(params: {
    from: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<{ id?: string | null } | void>;
}

function resendSender(): EmailSender {
  if (!env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured — cannot send invoice emails');
  }
  const client = new Resend(env.RESEND_API_KEY);
  return {
    async send({ from, to, subject, text }) {
      const res = await client.emails.send({ from, to, subject, text });
      if (res.error) throw new Error(`Resend error: ${res.error.message}`);
      return { id: res.data?.id ?? null };
    },
  };
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatDueDate(d: string | Date | null): string {
  if (!d) return 'On receipt';
  const iso = d instanceof Date ? d.toISOString().slice(0, 10) : d.slice(0, 10);
  return iso;
}

export async function sendInvoiceEmail(
  invoiceId: string,
  database: Knex = db,
  sender: EmailSender = resendSender()
): Promise<'sent' | 'skipped_no_email' | 'skipped_not_open'> {
  const invoice = (await database('invoices')
    .where({ id: invoiceId })
    .select('id', 'org_id', 'client_id', 'number', 'total_cents', 'due_date', 'payment_token', 'status')
    .first()) as InvoiceRow | undefined;

  if (!invoice) throw new Error(`Invoice ${invoiceId} not found`);
  if (invoice.status !== 'open') return 'skipped_not_open';
  if (!invoice.payment_token || !invoice.number) {
    throw new Error(`Invoice ${invoiceId} is missing payment_token or number`);
  }

  const [client, org] = await Promise.all([
    database('clients').where({ id: invoice.client_id }).select('name', 'email').first() as Promise<ClientRow | undefined>,
    database('organizations').where({ id: invoice.org_id }).select('name').first() as Promise<OrgRow | undefined>,
  ]);

  if (!client?.email) {
    logger.warn('Invoice email skipped: client has no email on file', {
      invoiceId,
      clientId: invoice.client_id,
    });
    return 'skipped_no_email';
  }

  const orgName = org?.name ?? 'Your service provider';
  const total = formatCents(typeof invoice.total_cents === 'string' ? Number(invoice.total_cents) : invoice.total_cents);
  const due = formatDueDate(invoice.due_date);
  const payUrl = `${env.FRONTEND_URL}/pay/${invoice.id}?token=${invoice.payment_token}`;

  const subject = `Invoice ${invoice.number} from ${orgName}`;
  const text = [
    `Hi ${client.name},`,
    '',
    `Your invoice ${invoice.number} for ${total} is ready.`,
    `Due: ${due}`,
    '',
    `Pay online: ${payUrl}`,
    '',
    'Thanks,',
    orgName,
  ].join('\n');

  const from = env.RESEND_FROM_ADDRESS;
  const result = await sender.send({ from, to: client.email, subject, text });

  await database('audit_log').insert({
    source: 'invoice-email',
    org_id: invoice.org_id,
    event_type: 'invoice.email.sent',
    external_id: invoice.id,
    status: 'processed',
    payload: { to: client.email, subject, resendId: (result && 'id' in result && result.id) || null },
  });

  logger.info('Invoice email sent', { invoiceId, to: client.email });
  return 'sent';
}

export async function processInvoiceEmailJob(
  job: Job<InvoiceEmailJobData>,
  database: Knex = db,
  sender?: EmailSender
): Promise<void> {
  const { invoiceId } = job.data;
  try {
    await sendInvoiceEmail(invoiceId, database, sender);
  } catch (err) {
    const message = (err as Error).message;
    logger.error('invoice-email worker: send failed', { invoiceId, err: message });
    await database('audit_log')
      .insert({
        source: 'invoice-email',
        event_type: 'invoice.email.send',
        external_id: invoiceId,
        status: 'error',
        error_detail: message,
      })
      .catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  const worker = new Worker<InvoiceEmailJobData>(
    INVOICE_EMAIL_QUEUE,
    (job) => processInvoiceEmailJob(job),
    { connection: redis, concurrency: 3 }
  );
  worker.on('completed', (job) => {
    logger.debug('invoice-email worker completed', { invoiceId: job.data.invoiceId });
  });
  worker.on('failed', (job, err) => {
    logger.error('invoice-email worker failed', { invoiceId: job?.data.invoiceId, err: err.message });
  });
  logger.info('invoice-email worker started', { queue: INVOICE_EMAIL_QUEUE });
}

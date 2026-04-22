import { Worker, Job } from 'bullmq';
import { Resend } from 'resend';
import type { Knex } from 'knex';

import { db } from '../config/database';
import { env } from '../config/env';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { WELCOME_EMAIL_QUEUE } from '../config/queues';
import type { WelcomeEmailJobData } from '../config/queues';
import { shouldSkipSend } from '../services/demo-skip';

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
    throw new Error('RESEND_API_KEY is not configured — cannot send welcome emails');
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

function formatTrialEnd(trialEndAt: number | null): string {
  if (!trialEndAt) return '30 days from today';
  return new Date(trialEndAt).toISOString().slice(0, 10);
}

export async function sendWelcomeEmail(
  data: WelcomeEmailJobData,
  database: Knex = db,
  sender: EmailSender = resendSender()
): Promise<'sent' | 'skipped_example_domain'> {
  const { email, trialEndAt, stripeSubscriptionId } = data;

  const skip = shouldSkipSend({ seededAt: null, email });
  if (skip.skip) {
    await database('audit_log').insert({
      source: 'welcome-email',
      event_type: 'welcome.email.skipped',
      external_id: stripeSubscriptionId,
      status: 'ignored',
      payload: { to: email, reason: skip.reason },
    });
    logger.info('Welcome email skipped', { to: email, reason: skip.reason });
    return 'skipped_example_domain';
  }

  const activateUrl = `${env.FRONTEND_URL}/activate?email=${encodeURIComponent(email)}`;
  const trialEndLine = `Your 30-day trial runs through ${formatTrialEnd(trialEndAt)}.`;

  const subject = 'Activate your Professional Billing account';
  const text = [
    'Welcome to Professional Billing.',
    '',
    'Your subscription is active and your account is provisioned. To sign in:',
    '',
    `  ${activateUrl}`,
    '',
    "Click the link above and we'll email you a 6-digit code. Enter it and you're in — no password to choose.",
    '',
    trialEndLine,
    '',
    'Thanks,',
    'Fratelli Software',
  ].join('\n');

  const result = await sender.send({
    from: env.RESEND_FROM_ADDRESS,
    to: email,
    subject,
    text,
  });

  await database('audit_log').insert({
    source: 'welcome-email',
    event_type: 'welcome.email.sent',
    external_id: stripeSubscriptionId,
    status: 'processed',
    payload: {
      to: email,
      subject,
      resendId: (result && 'id' in result && result.id) || null,
    },
  });

  logger.info('Welcome email sent', { to: email, stripeSubscriptionId });
  return 'sent';
}

export async function processWelcomeEmailJob(
  job: Job<WelcomeEmailJobData>,
  database: Knex = db,
  sender?: EmailSender
): Promise<void> {
  try {
    const resolvedSender = sender ?? resendSender();
    await sendWelcomeEmail(job.data, database, resolvedSender);
  } catch (err) {
    const message = (err as Error).message;
    logger.error('welcome-email worker: send failed', {
      email: job.data.email,
      err: message,
    });
    await database('audit_log')
      .insert({
        source: 'welcome-email',
        event_type: 'welcome.email.send',
        external_id: job.data.stripeSubscriptionId,
        status: 'error',
        error_detail: message,
      })
      .catch(() => {});
    throw err;
  }
}

if (require.main === module) {
  const worker = new Worker<WelcomeEmailJobData>(
    WELCOME_EMAIL_QUEUE,
    (job) => processWelcomeEmailJob(job),
    { connection: redis, concurrency: 3 }
  );
  worker.on('completed', (job) => {
    logger.debug('welcome-email worker completed', { email: job.data.email });
  });
  worker.on('failed', (job, err) => {
    logger.error('welcome-email worker failed', {
      email: job?.data.email,
      err: err.message,
    });
  });
  logger.info('welcome-email worker started', { queue: WELCOME_EMAIL_QUEUE });
}

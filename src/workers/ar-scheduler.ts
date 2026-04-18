/**
 * Phase 2C — AR scheduler worker.
 *
 * BullMQ repeatable job fires daily at 09:00 UTC. Each tick iterates orgs
 * where `ar_automation_enabled = true` and `ar_run_day_of_month` matches
 * today's UTC day. For each matched org we open a transaction on raw `db`
 * (RLS bypass — workers manage tenants manually) and call the shared
 * `executeAR` service. Idempotency is guaranteed by an `audit_log` row
 * keyed `<orgId>-<YYYY-MM-DD>` inside the same transaction.
 */

import { Worker, Queue, Job } from 'bullmq';
import type { Knex } from 'knex';

import { db } from '../config/database';
import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { executeAR } from '../services/ar-executor';

export const AR_SCHEDULER_QUEUE = 'ar-scheduler';
const REPEATABLE_JOB_NAME = 'ar-scheduler:daily';
const DAILY_CRON = '0 9 * * *';

export interface ArSchedulerJobData {
  // Empty for the repeatable job; present keys reserve room for future manual
  // triggers (e.g., admin endpoint enqueues a specific orgId).
  orgId?: string;
}

interface OrgRow {
  id: string;
}

export async function processTick(
  database: Knex = db,
  now: Date = new Date()
): Promise<{ handledOrgs: string[]; skippedOrgs: string[] }> {
  const day = now.getUTCDate();
  const orgs = (await database('organizations')
    .where({ ar_automation_enabled: true, ar_run_day_of_month: day })
    .select('id')) as OrgRow[];

  const handledOrgs: string[] = [];
  const skippedOrgs: string[] = [];

  for (const org of orgs) {
    try {
      const result = await database.transaction(async (trx) => {
        return executeAR(org.id, now, {
          triggeredBy: 'scheduler',
          t: (table: string) => trx(table),
        });
      });
      if (result.skipped) {
        skippedOrgs.push(org.id);
      } else {
        handledOrgs.push(org.id);
      }
    } catch (err) {
      logger.error('ar-scheduler: executeAR failed', {
        orgId: org.id,
        err: (err as Error).message,
      });
      // Continue with the next org; a single failure should not halt the tick.
    }
  }
  return { handledOrgs, skippedOrgs };
}

export async function processSchedulerJob(
  _job: Job<ArSchedulerJobData>,
  database: Knex = db
): Promise<void> {
  const result = await processTick(database);
  logger.info('ar-scheduler tick complete', {
    handled: result.handledOrgs.length,
    skipped: result.skippedOrgs.length,
  });
}

async function registerRepeatable(queue: Queue<ArSchedulerJobData>) {
  await queue.add(
    REPEATABLE_JOB_NAME,
    {},
    { repeat: { pattern: DAILY_CRON }, removeOnComplete: true, removeOnFail: true }
  );
  logger.info('ar-scheduler repeatable registered', { cron: DAILY_CRON });
}

if (require.main === module) {
  const queue = new Queue<ArSchedulerJobData>(AR_SCHEDULER_QUEUE, { connection: redis });
  void registerRepeatable(queue);

  const worker = new Worker<ArSchedulerJobData>(
    AR_SCHEDULER_QUEUE,
    (job) => processSchedulerJob(job),
    { connection: redis, concurrency: 1 }
  );
  worker.on('completed', () => {
    logger.debug('ar-scheduler worker completed tick');
  });
  worker.on('failed', (_job, err) => {
    logger.error('ar-scheduler worker failed', { err: err.message });
  });
  logger.info('ar-scheduler worker started', { queue: AR_SCHEDULER_QUEUE });
}

import { Router, Request, Response } from 'express';
import { verifyWebhook } from '@clerk/express/webhooks';
import type { Knex } from 'knex';
import { db } from '../config/database';
import { logger } from '../utils/logger';

const router = Router();

interface AuditEntry {
  source: string;
  event_type: string;
  external_id: string | null;
  payload: object;
  status: 'processed' | 'ignored' | 'error';
  error_detail?: string;
}

async function logAudit(entry: AuditEntry, database: Knex): Promise<void> {
  await database('audit_log').insert(entry);
}

export async function ensureOrg(
  clerkOrgId: string,
  name: string,
  database: Knex
): Promise<{ id: string }> {
  const existing = await database('organizations')
    .where({ clerk_org_id: clerkOrgId })
    .select('id')
    .first();
  if (existing) return existing;

  await database('organizations')
    .insert({ clerk_org_id: clerkOrgId, name, plan: 'free' })
    .onConflict('clerk_org_id')
    .ignore();

  const org = await database('organizations')
    .where({ clerk_org_id: clerkOrgId })
    .select('id')
    .first();

  if (!org) {
    throw new Error(`ensureOrg: insert raced and row still missing for ${clerkOrgId}`);
  }
  return org;
}

export interface ClerkEventResult {
  status: number;
  body: object;
}

/**
 * Pure handler — easy to unit-test by passing a mock Knex.
 * Returns 5xx on error so Clerk retries; handlers are idempotent.
 */
export async function handleClerkEvent(
  evt: { type: string; data: Record<string, unknown> },
  database: Knex = db
): Promise<ClerkEventResult> {
  const eventType = evt.type;
  let externalId: string | null = null;

  try {
    switch (eventType) {
      case 'organization.created': {
        const data = evt.data as { id: string; name: string };
        externalId = data.id;
        const existing = await database('organizations')
          .where({ clerk_org_id: data.id })
          .select('id')
          .first();
        if (existing) {
          await logAudit(
            { source: 'clerk', event_type: eventType, external_id: data.id, payload: evt.data, status: 'ignored' },
            database
          );
          logger.info(`Clerk organization.created: ${data.id} (already exists)`);
        } else {
          await ensureOrg(data.id, data.name, database);
          await logAudit(
            { source: 'clerk', event_type: eventType, external_id: data.id, payload: evt.data, status: 'processed' },
            database
          );
          logger.info(`Clerk organization.created: ${data.id}`, { name: data.name });
        }
        break;
      }

      case 'organization.deleted': {
        const data = evt.data as { id: string };
        externalId = data.id ?? null;
        const deleted = await database('organizations').where({ clerk_org_id: data.id }).del();
        await logAudit(
          {
            source: 'clerk',
            event_type: eventType,
            external_id: data.id ?? null,
            payload: evt.data,
            status: deleted > 0 ? 'processed' : 'ignored',
          },
          database
        );
        logger.info(`Clerk organization.deleted: ${data.id}`, { rowsDeleted: deleted });
        break;
      }

      case 'user.created': {
        const data = evt.data as { id: string; email_addresses?: { email_address: string }[] };
        externalId = data.id;
        // Audit only — membership event populates org_id.
        await logAudit(
          { source: 'clerk', event_type: eventType, external_id: data.id, payload: evt.data, status: 'processed' },
          database
        );
        logger.info(`Clerk user.created: ${data.id} (audit only)`);
        break;
      }

      case 'user.deleted': {
        const data = evt.data as { id: string };
        externalId = data.id ?? null;

        const already = await database('audit_log')
          .where({ source: 'clerk', event_type: eventType, external_id: data.id, status: 'processed' })
          .select('id')
          .first();
        if (already) {
          logger.info(`Clerk user.deleted: ${data.id} (already processed, skipping)`);
          break;
        }

        const user = await database('users')
          .where({ clerk_user_id: data.id })
          .select('id')
          .first();

        if (!user) {
          await logAudit(
            {
              source: 'clerk',
              event_type: eventType,
              external_id: data.id ?? null,
              payload: evt.data,
              status: 'ignored',
            },
            database
          );
          logger.info(`Clerk user.deleted: ${data.id} (no matching user)`);
          break;
        }

        const deleted = await database('users').where({ id: user.id }).del();
        await logAudit(
          {
            source: 'clerk',
            event_type: eventType,
            external_id: data.id ?? null,
            payload: evt.data,
            status: 'processed',
          },
          database
        );
        logger.info(`Clerk user.deleted: ${data.id}`, { rowsDeleted: deleted });
        break;
      }

      case 'organizationMembership.created': {
        const data = evt.data as {
          organization: { id: string; name: string };
          public_user_data: { user_id: string; identifier?: string };
        };
        const clerkOrgId = data.organization.id;
        const clerkUserId = data.public_user_data.user_id;
        externalId = clerkUserId;
        const email =
          data.public_user_data.identifier || `${clerkUserId}@placeholder.professionalbilling`;

        const org = await ensureOrg(clerkOrgId, data.organization.name, database);

        const existingMemberCount = await database('users')
          .where({ org_id: org.id })
          .count<{ count: string | number }[]>('id as count')
          .first();

        const isFirstMember =
          !existingMemberCount || Number(existingMemberCount.count) === 0;
        const role = isFirstMember ? 'owner' : 'member';

        const existingUser = await database('users')
          .where({ clerk_user_id: clerkUserId })
          .select('id')
          .first();

        if (existingUser) {
          await logAudit(
            {
              source: 'clerk',
              event_type: eventType,
              external_id: clerkUserId,
              payload: evt.data,
              status: 'ignored',
            },
            database
          );
          logger.info(`Clerk membership.created: user ${clerkUserId} already exists`);
        } else {
          await database('users')
            .insert({ org_id: org.id, clerk_user_id: clerkUserId, email, role })
            .onConflict('clerk_user_id')
            .ignore();
          await logAudit(
            {
              source: 'clerk',
              event_type: eventType,
              external_id: clerkUserId,
              payload: evt.data,
              status: 'processed',
            },
            database
          );
          logger.info(`Clerk membership.created: user ${clerkUserId} -> org ${clerkOrgId}`, { role });
        }
        break;
      }

      case 'organizationMembership.deleted': {
        const data = evt.data as {
          organization: { id: string };
          public_user_data: { user_id: string };
        };
        const clerkUserId = data.public_user_data.user_id;
        externalId = clerkUserId;
        const deleted = await database('users').where({ clerk_user_id: clerkUserId }).del();
        await logAudit(
          {
            source: 'clerk',
            event_type: eventType,
            external_id: clerkUserId,
            payload: evt.data,
            status: deleted > 0 ? 'processed' : 'ignored',
          },
          database
        );
        logger.info(`Clerk membership.deleted: user ${clerkUserId}`, { rowsDeleted: deleted });
        break;
      }

      default: {
        await logAudit(
          { source: 'clerk', event_type: eventType, external_id: null, payload: evt.data, status: 'ignored' },
          database
        );
        logger.info(`Clerk webhook ignored: ${eventType}`);
      }
    }

    return { status: 200, body: { received: true } };
  } catch (err) {
    logger.error(`Clerk webhook error for ${eventType}`, { err: (err as Error).message });
    await logAudit(
      {
        source: 'clerk',
        event_type: eventType,
        external_id: externalId,
        payload: evt.data as object,
        status: 'error',
        error_detail: (err as Error).message,
      },
      database
    ).catch((auditErr) => {
      logger.error('Failed to write audit log', { err: (auditErr as Error).message });
    });
    return { status: 500, body: { error: 'webhook_handler_failed' } };
  }
}

router.post('/clerk', async (req: Request, res: Response) => {
  let evt;
  try {
    evt = await verifyWebhook(req);
  } catch (err) {
    logger.warn('Clerk webhook verification failed', { err: (err as Error).message });
    res.status(400).json({ error: 'Webhook verification failed' });
    return;
  }

  const result = await handleClerkEvent(
    evt as unknown as { type: string; data: Record<string, unknown> }
  );
  res.status(result.status).json(result.body);
});

export default router;

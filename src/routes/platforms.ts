import { Router } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';

import { registry } from '../openapi/registry';
import { db } from '../config/database';
import { tdb } from '../config/tenant-context';
import { tenantScope } from '../middleware/tenant-scope';
import { AppError } from '../middleware/error-handler';
import { decrypt } from '../utils/crypto';
import { logger } from '../utils/logger';
import { deauthorizeStripeAccount } from '../services/stripe-oauth';

type TableFn = (table: string) => Knex.QueryBuilder;

export interface PlatformsDeps {
  tdb: TableFn;
  db: TableFn;
  deauthorize: typeof deauthorizeStripeAccount;
}

const defaultDeps: PlatformsDeps = {
  tdb: tdb as TableFn,
  db: db as unknown as TableFn,
  deauthorize: deauthorizeStripeAccount,
};

const PlatformSchema = z
  .object({
    id: z.string().uuid(),
    type: z.string(),
    external_account_id: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Platform');

const ListResponse = z.object({ data: z.array(PlatformSchema) });
const IdParam = z.object({ id: z.string().uuid() });

registry.registerPath({
  method: 'get',
  path: '/api/platforms',
  tags: ['platforms'],
  summary: "List the current org's connected platforms",
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: {
      description: 'Platforms',
      content: { 'application/json': { schema: ListResponse } },
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/platforms/{id}',
  tags: ['platforms'],
  summary: 'Disconnect a platform (revoke credentials and delete the row)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: IdParam },
  responses: {
    204: { description: 'Disconnected' },
    404: { description: 'Platform not found for this org' },
  },
});

export async function handleList(
  params: { orgId: string },
  deps: PlatformsDeps = defaultDeps
) {
  const rows = await deps
    .tdb('platforms')
    .where({ org_id: params.orgId })
    .select('id', 'type', 'external_account_id', 'created_at', 'updated_at')
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleDelete(
  params: { id: string; orgId: string; userId?: string; userEmail?: string },
  deps: PlatformsDeps = defaultDeps
): Promise<void> {
  const row = await deps
    .tdb('platforms')
    .where({ id: params.id, org_id: params.orgId })
    .select(
      'id',
      'type',
      'external_account_id',
      'credentials_encrypted',
      'credentials_iv',
      'credentials_tag'
    )
    .first();

  if (!row) throw new AppError(404, 'Platform not found');

  const { stripeUserId } = extractStripeCredentials(row);

  let status: 'processed' | 'error' = 'processed';
  let errorDetail: string | null = null;
  let alreadyRevoked = false;
  try {
    const result = await deps.deauthorize({ stripeUserId });
    alreadyRevoked = result.alreadyRevoked ?? false;
    logger.info('Stripe deauthorized', {
      orgId: params.orgId,
      stripeUserId,
      alreadyRevoked,
    });
  } catch (err) {
    status = 'error';
    errorDetail = (err as Error).message;
    logger.warn('Stripe deauthorize failed; proceeding with platform row deletion', {
      orgId: params.orgId,
      stripeUserId,
      err: errorDetail,
    });
  }

  const org = (await deps
    .tdb('organizations')
    .where({ id: params.orgId })
    .select('name')
    .first()) as { name: string } | undefined;

  const deleted = await deps
    .tdb('platforms')
    .where({ id: params.id, org_id: params.orgId })
    .del();
  const platformRowDeleted = Number(deleted) > 0;

  await deps.db('audit_log').insert({
    source: 'stripe',
    org_id: params.orgId,
    event_type: 'oauth.deauthorize',
    external_id: stripeUserId,
    status,
    error_detail: errorDetail,
    payload: {
      stripe_account_id: stripeUserId,
      platform_row_id: row.id,
      platform_type: row.type,
      platform_row_existed_before: true,
      platform_row_deleted: platformRowDeleted,
      already_revoked: alreadyRevoked,
      app_org_id: params.orgId,
      app_org_name: org?.name ?? null,
      initiator_user_id: params.userId ?? null,
      initiator_email: params.userEmail ?? null,
      triggered_by: 'api.platforms.delete',
    },
  });
}

interface PlatformRow {
  id: string;
  type: string;
  external_account_id: string | null;
  credentials_encrypted: Buffer | null;
  credentials_iv: Buffer | null;
  credentials_tag: Buffer | null;
}

function extractStripeCredentials(row: PlatformRow): { stripeUserId: string } {
  if (!row.credentials_encrypted || !row.credentials_iv || !row.credentials_tag) {
    throw new AppError(500, 'Platform credentials are missing or corrupted');
  }
  try {
    const plaintext = decrypt({
      encrypted: row.credentials_encrypted.toString('base64'),
      iv: row.credentials_iv.toString('hex'),
      tag: row.credentials_tag.toString('hex'),
    });
    const parsed = JSON.parse(plaintext) as {
      access_token?: string;
      stripe_user_id?: string;
    };
    if (!parsed.access_token) {
      throw new Error('access_token missing from decrypted credentials');
    }
    const stripeUserId = parsed.stripe_user_id ?? row.external_account_id;
    if (!stripeUserId) {
      throw new AppError(
        500,
        'Platform is missing stripe_user_id (both decrypted payload and external_account_id are unset)'
      );
    }
    return { stripeUserId };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, `Failed to decrypt platform credentials: ${(err as Error).message}`);
  }
}

const router = Router();

router.get(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleList({ orgId: req.org!.id }));
  })
);

router.delete(
  '/:id',
  tenantScope(async (req, res) => {
    const { id } = IdParam.parse(req.params);
    await handleDelete({
      id,
      orgId: req.org!.id,
      userId: req.userId,
      userEmail: req.userEmail,
    });
    res.status(204).send();
  })
);

export default router;

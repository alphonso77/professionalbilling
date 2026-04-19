import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const UserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    clerk_user_id: z.string(),
    role: z.enum(['owner', 'admin', 'member']),
    default_rate_cents: z.number().int().nullable(),
    is_admin: z.boolean(),
    easter_egg_enabled: z.boolean(),
  })
  .openapi('MeUser');

const MeResponse = z.object({
  data: z.object({
    user: UserSchema.nullable(),
    org: z.object({
      id: z.string().uuid(),
      clerk_org_id: z.string(),
      plan: z.string(),
    }),
  }),
});

const UpdateMeBody = z
  .object({
    default_rate_cents: z.number().int().min(0).nullable().optional(),
  })
  .openapi('UpdateMeBody');

const USER_COLUMNS = [
  'id',
  'email',
  'clerk_user_id',
  'role',
  'default_rate_cents',
  'is_admin',
  'easter_egg_enabled',
];

registry.registerPath({
  method: 'get',
  path: '/api/me',
  tags: ['me'],
  summary: 'Current user + org context',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: {
      description: 'Caller identity and org',
      content: { 'application/json': { schema: MeResponse } },
    },
    401: { description: 'Not authenticated' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/me',
  tags: ['me'],
  summary: 'Update current user profile',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: UpdateMeBody } } } },
  responses: {
    200: {
      description: 'Updated caller identity and org',
      content: { 'application/json': { schema: MeResponse } },
    },
    400: { description: 'Validation error' },
    401: { description: 'Not authenticated' },
  },
});

export async function handleMe(req: AuthenticatedRequest) {
  const userRow = req.userId
    ? await tdb('users')
        .where({ id: req.userId, org_id: req.org!.id })
        .select(USER_COLUMNS)
        .first()
    : null;
  return {
    data: {
      user: userRow ?? null,
      org: {
        id: req.org!.id,
        clerk_org_id: req.org!.clerk_org_id,
        plan: req.org!.plan,
      },
    },
  };
}

export async function handleUpdateMe(req: AuthenticatedRequest) {
  if (!req.userId) throw new AppError(401, 'Authentication required');
  const body = UpdateMeBody.parse(req.body);
  const patch: Record<string, unknown> = {};
  if ('default_rate_cents' in body) patch.default_rate_cents = body.default_rate_cents;
  if (Object.keys(patch).length) {
    await tdb('users').where({ id: req.userId, org_id: req.org!.id }).update(patch);
  }
  return handleMe(req);
}

router.get(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleMe(req));
  })
);

router.patch(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleUpdateMe(req));
  })
);

export default router;
export { UpdateMeBody };

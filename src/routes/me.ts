import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const MeResponse = z.object({
  data: z.object({
    user: z
      .object({
        id: z.string().uuid(),
        email: z.string().email().nullable(),
        clerk_user_id: z.string(),
        role: z.enum(['owner', 'admin', 'member']),
      })
      .nullable(),
    org: z.object({
      id: z.string().uuid(),
      clerk_org_id: z.string(),
      plan: z.string(),
    }),
  }),
});

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

export async function handleMe(req: AuthenticatedRequest) {
  const userRow = req.userId
    ? await tdb('users')
        .where({ id: req.userId })
        .select('id', 'email', 'clerk_user_id', 'role')
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

router.get(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleMe(req));
  })
);

export default router;

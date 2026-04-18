import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { requireAdmin } from '../middleware/require-admin';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const AdminUserSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    role: z.enum(['owner', 'admin', 'member']),
    is_admin: z.boolean(),
    easter_egg_enabled: z.boolean(),
    created_at: z.string(),
  })
  .openapi('AdminUserRow');

const UpdateAdminUserBody = z
  .object({
    is_admin: z.boolean().optional(),
    easter_egg_enabled: z.boolean().optional(),
  })
  .openapi('UpdateAdminUserBody');

const IdParam = z.object({ id: z.string().uuid() });

const ListResponse = z.object({ data: z.array(AdminUserSchema) });
const OneResponse = z.object({ data: AdminUserSchema });

const ADMIN_USER_COLUMNS = [
  'id',
  'email',
  'role',
  'is_admin',
  'easter_egg_enabled',
  'created_at',
];

registry.registerPath({
  method: 'get',
  path: '/api/admin/users',
  tags: ['admin'],
  summary: 'List users in the current org (admin only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Users', content: { 'application/json': { schema: ListResponse } } },
    403: { description: 'Not an admin' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/admin/users/{id}',
  tags: ['admin'],
  summary: 'Update a user (admin only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateAdminUserBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error / last admin' },
    403: { description: 'Not an admin' },
    404: { description: 'Not found' },
  },
});

export async function handleList() {
  const rows = await tdb('users')
    .select(ADMIN_USER_COLUMNS)
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleUpdate(req: AuthenticatedRequest) {
  const { id } = IdParam.parse(req.params);
  const body = UpdateAdminUserBody.parse(req.body);

  const target = (await tdb('users')
    .where({ id })
    .select('id', 'is_admin')
    .first()) as { id: string; is_admin: boolean } | undefined;
  if (!target) throw new AppError(404, 'User not found');

  if (body.is_admin === false && target.is_admin === true) {
    const otherAdmins = (await tdb('users')
      .where({ is_admin: true })
      .whereNot({ id })
      .count<{ count: string }[]>({ count: '*' })
      .first()) as { count: string } | undefined;
    const count = otherAdmins ? Number(otherAdmins.count) : 0;
    if (count === 0) {
      throw new AppError(400, 'Cannot remove the last admin', 'LAST_ADMIN');
    }
  }

  const patch: Record<string, unknown> = {};
  if ('is_admin' in body) patch.is_admin = body.is_admin;
  if ('easter_egg_enabled' in body) patch.easter_egg_enabled = body.easter_egg_enabled;

  if (Object.keys(patch).length === 0) {
    const row = await tdb('users').where({ id }).select(ADMIN_USER_COLUMNS).first();
    return { data: row };
  }

  const rows = await tdb('users')
    .where({ id })
    .update(patch)
    .returning(ADMIN_USER_COLUMNS);
  if (!rows.length) throw new AppError(404, 'User not found');
  return { data: rows[0] };
}

router.get(
  '/users',
  requireAdmin(async (_req, res) => {
    res.json(await handleList());
  })
);

router.patch(
  '/users/:id',
  requireAdmin(async (req, res) => {
    res.json(await handleUpdate(req));
  })
);

export default router;
export { UpdateAdminUserBody, AdminUserSchema };

import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { db } from '../config/database';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { requireAdmin } from '../middleware/require-admin';
import { requireSuperAdmin } from '../middleware/require-super-admin';
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

const AdminFeedbackSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid().nullable(),
    user_id: z.string().uuid().nullable(),
    type: z.enum(['bug', 'feature', 'ui', 'other']),
    subject: z.string(),
    body: z.string(),
    status: z.enum(['pending', 'acknowledged', 'clarification_requested', 'resolved']),
    admin_note: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    submitter_email: z.string().email().nullable(),
    org_name: z.string().nullable(),
  })
  .openapi('AdminFeedbackRow');

const UpdateAdminFeedbackBody = z
  .object({
    status: z
      .enum(['pending', 'acknowledged', 'clarification_requested', 'resolved'])
      .optional(),
    admin_note: z.string().nullable().optional(),
  })
  .openapi('UpdateAdminFeedbackBody');

const AllUsersRowSchema = z
  .object({
    id: z.string().uuid(),
    email: z.string().email().nullable(),
    role: z.enum(['owner', 'admin', 'member']),
    is_admin: z.boolean(),
    is_super_admin: z.boolean(),
    org_id: z.string().uuid().nullable(),
    org_name: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi('AdminAllUsersRow');

const IdParam = z.object({ id: z.string().uuid() });

const ListResponse = z.object({ data: z.array(AdminUserSchema) });
const OneResponse = z.object({ data: AdminUserSchema });
const AdminFeedbackListResponse = z.object({ data: z.array(AdminFeedbackSchema) });
const AdminFeedbackOneResponse = z.object({ data: AdminFeedbackSchema });
const AllUsersListResponse = z.object({ data: z.array(AllUsersRowSchema) });

const ADMIN_USER_COLUMNS = [
  'id',
  'email',
  'role',
  'is_admin',
  'easter_egg_enabled',
  'created_at',
];

const ADMIN_FEEDBACK_COLUMNS = [
  'id',
  'org_id',
  'user_id',
  'submitter_email',
  'org_name',
  'type',
  'subject',
  'body',
  'status',
  'admin_note',
  'created_at',
  'updated_at',
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

registry.registerPath({
  method: 'get',
  path: '/api/admin/feedback',
  tags: ['admin'],
  summary: 'List all product feedback across orgs (super-admin only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: {
      description: 'Feedback',
      content: { 'application/json': { schema: AdminFeedbackListResponse } },
    },
    403: { description: 'Not a super-admin' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/admin/feedback/{id}',
  tags: ['admin'],
  summary: 'Update feedback status / admin note (super-admin only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: IdParam,
    body: { content: { 'application/json': { schema: UpdateAdminFeedbackBody } } },
  },
  responses: {
    200: {
      description: 'Updated',
      content: { 'application/json': { schema: AdminFeedbackOneResponse } },
    },
    400: { description: 'Validation error' },
    403: { description: 'Not a super-admin' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/admin/all-users',
  tags: ['admin'],
  summary: 'List all users across all orgs (super-admin only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: {
      description: 'Users',
      content: { 'application/json': { schema: AllUsersListResponse } },
    },
    403: { description: 'Not a super-admin' },
  },
});

export async function handleList(req: AuthenticatedRequest) {
  const rows = await tdb('users')
    .where({ org_id: req.org!.id })
    .select(ADMIN_USER_COLUMNS)
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleUpdate(req: AuthenticatedRequest) {
  const { id } = IdParam.parse(req.params);
  const orgId = req.org!.id;
  const body = UpdateAdminUserBody.parse(req.body);

  const target = (await tdb('users')
    .where({ id, org_id: orgId })
    .select('id', 'is_admin')
    .first()) as { id: string; is_admin: boolean } | undefined;
  if (!target) throw new AppError(404, 'User not found');

  if (body.is_admin === false && target.is_admin === true) {
    const otherAdmins = (await tdb('users')
      .where({ is_admin: true, org_id: orgId })
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
    const row = await tdb('users')
      .where({ id, org_id: orgId })
      .select(ADMIN_USER_COLUMNS)
      .first();
    return { data: row };
  }

  const rows = await tdb('users')
    .where({ id, org_id: orgId })
    .update(patch)
    .returning(ADMIN_USER_COLUMNS);
  if (!rows.length) throw new AppError(404, 'User not found');
  return { data: rows[0] };
}

export async function handleFeedbackList(_req: AuthenticatedRequest) {
  const rows = await db('corporate.feedback')
    .select(ADMIN_FEEDBACK_COLUMNS)
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleFeedbackUpdate(req: AuthenticatedRequest) {
  const { id } = IdParam.parse(req.params);
  const body = UpdateAdminFeedbackBody.parse(req.body);

  const patch: Record<string, unknown> = {};
  if ('status' in body) patch.status = body.status;
  if ('admin_note' in body) patch.admin_note = body.admin_note;

  if (Object.keys(patch).length === 0) {
    const row = await db('corporate.feedback')
      .where({ id })
      .select(ADMIN_FEEDBACK_COLUMNS)
      .first();
    if (!row) throw new AppError(404, 'Feedback not found');
    return { data: row };
  }

  const rows = await db('corporate.feedback')
    .where({ id })
    .update(patch)
    .returning(ADMIN_FEEDBACK_COLUMNS);
  if (!rows.length) throw new AppError(404, 'Feedback not found');
  return { data: rows[0] };
}

export async function handleAllUsersList(_req: AuthenticatedRequest) {
  const rows = await db('users')
    .leftJoin('organizations', 'organizations.id', 'users.org_id')
    .select(
      'users.id as id',
      'users.email as email',
      'users.role as role',
      'users.is_admin as is_admin',
      'users.is_super_admin as is_super_admin',
      'users.created_at as created_at',
      'organizations.id as org_id',
      'organizations.name as org_name'
    )
    .orderBy('organizations.name', 'asc')
    .orderBy('users.created_at', 'desc');
  return { data: rows };
}

router.get(
  '/users',
  requireAdmin(async (req, res) => {
    res.json(await handleList(req));
  })
);

router.patch(
  '/users/:id',
  requireAdmin(async (req, res) => {
    res.json(await handleUpdate(req));
  })
);

router.get(
  '/all-users',
  requireSuperAdmin(async (req, res) => {
    res.json(await handleAllUsersList(req));
  })
);

router.get(
  '/feedback',
  requireSuperAdmin(async (req, res) => {
    res.json(await handleFeedbackList(req));
  })
);

router.patch(
  '/feedback/:id',
  requireSuperAdmin(async (req, res) => {
    res.json(await handleFeedbackUpdate(req));
  })
);

export default router;
export {
  UpdateAdminUserBody,
  AdminUserSchema,
  UpdateAdminFeedbackBody,
  AdminFeedbackSchema,
  AllUsersRowSchema,
};

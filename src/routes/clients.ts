import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const ClientSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    name: z.string(),
    email: z.string().nullable(),
    billing_address: z.string().nullable(),
    notes: z.string().nullable(),
    default_rate_cents: z.number().int().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Client');

const CreateClientBody = z
  .object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    billing_address: z.string().optional(),
    notes: z.string().optional(),
    default_rate_cents: z.number().int().min(0).nullable().optional(),
  })
  .openapi('CreateClientBody');

const UpdateClientBody = z
  .object({
    name: z.string().min(1).optional(),
    email: z.string().email().nullable().optional(),
    billing_address: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    default_rate_cents: z.number().int().min(0).nullable().optional(),
  })
  .openapi('UpdateClientBody');

const ListResponse = z.object({ data: z.array(ClientSchema) });
const OneResponse = z.object({ data: ClientSchema });
const DeleteResponse = z.object({ data: z.object({ id: z.string().uuid() }) });

registry.registerPath({
  method: 'get',
  path: '/api/clients',
  tags: ['clients'],
  summary: 'List clients for the current org',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Clients', content: { 'application/json': { schema: ListResponse } } },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Get a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Client', content: { 'application/json': { schema: OneResponse } } },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/clients',
  tags: ['clients'],
  summary: 'Create a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: CreateClientBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error' },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Update a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateClientBody } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error' },
    404: { description: 'Not found' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/clients/{id}',
  tags: ['clients'],
  summary: 'Delete a client',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: DeleteResponse } } },
    404: { description: 'Not found' },
  },
});

const CLIENT_COLUMNS = [
  'id',
  'org_id',
  'name',
  'email',
  'billing_address',
  'notes',
  'default_rate_cents',
  'created_at',
  'updated_at',
];

export async function handleList() {
  const rows = await tdb('clients').select(CLIENT_COLUMNS).orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleGet(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const row = await tdb('clients').where({ id }).select(CLIENT_COLUMNS).first();
  if (!row) throw new AppError(404, 'Client not found');
  return { data: row };
}

export async function handleCreate(req: AuthenticatedRequest) {
  const body = CreateClientBody.parse(req.body);
  const [row] = await tdb('clients')
    .insert({
      org_id: req.org!.id,
      name: body.name,
      email: body.email ?? null,
      billing_address: body.billing_address ?? null,
      notes: body.notes ?? null,
      default_rate_cents: body.default_rate_cents ?? null,
    })
    .returning(CLIENT_COLUMNS);
  return { data: row };
}

export async function handleUpdate(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const body = UpdateClientBody.parse(req.body);
  const patch: Record<string, unknown> = {};
  for (const k of [
    'name',
    'email',
    'billing_address',
    'notes',
    'default_rate_cents',
  ] as const) {
    if (k in body) patch[k] = body[k];
  }
  if (Object.keys(patch).length === 0) {
    const row = await tdb('clients').where({ id }).select(CLIENT_COLUMNS).first();
    if (!row) throw new AppError(404, 'Client not found');
    return { data: row };
  }
  const rows = await tdb('clients').where({ id }).update(patch).returning(CLIENT_COLUMNS);
  if (!rows.length) throw new AppError(404, 'Client not found');
  return { data: rows[0] };
}

export async function handleDelete(req: AuthenticatedRequest) {
  const id = z.string().uuid().parse(req.params.id);
  const deleted = await tdb('clients').where({ id }).del();
  if (!deleted) throw new AppError(404, 'Client not found');
  return { data: { id } };
}

router.get(
  '/',
  tenantScope(async (_req, res) => {
    res.json(await handleList());
  })
);

router.get(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleGet(req));
  })
);

router.post(
  '/',
  tenantScope(async (req, res) => {
    const result = await handleCreate(req);
    res.status(201).json(result);
  })
);

router.patch(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleUpdate(req));
  })
);

router.delete(
  '/:id',
  tenantScope(async (req, res) => {
    res.json(await handleDelete(req));
  })
);

export default router;
export { CreateClientBody, UpdateClientBody };

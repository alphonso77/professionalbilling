import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';
import { AppError } from '../middleware/error-handler';

const router = Router();

const TimeEntrySchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    client_id: z.string().uuid().nullable(),
    description: z.string(),
    started_at: z.string(),
    ended_at: z.string(),
    duration_minutes: z.number().int(),
    hourly_rate_cents: z.number().int().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('TimeEntry');

const ListQuery = z.object({
  client_id: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

const CreateBody = z
  .object({
    client_id: z.string().uuid().optional(),
    description: z.string().min(1),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime(),
    hourly_rate_cents: z.number().int().nonnegative().optional(),
  })
  .openapi('CreateTimeEntryBody');

const ListResponse = z.object({ data: z.array(TimeEntrySchema) });
const CreateResponse = z.object({
  data: z.object({
    entry: TimeEntrySchema,
    warnings: z.array(z.string()).optional(),
  }),
});

registry.registerPath({
  method: 'get',
  path: '/api/time-entries',
  tags: ['time-entries'],
  summary: 'List time entries',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { query: ListQuery },
  responses: {
    200: { description: 'Entries', content: { 'application/json': { schema: ListResponse } } },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/time-entries',
  tags: ['time-entries'],
  summary: 'Log a time entry',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: CreateBody } } } },
  responses: {
    201: {
      description: 'Created (with optional warnings)',
      content: { 'application/json': { schema: CreateResponse } },
    },
    400: { description: 'Validation error' },
  },
});

export async function handleList(req: AuthenticatedRequest) {
  const query = ListQuery.parse(req.query);
  const qb = tdb('time_entries').select('*').orderBy('started_at', 'desc');
  if (query.client_id) qb.where({ client_id: query.client_id });
  if (query.from) qb.where('started_at', '>=', query.from);
  if (query.to) qb.where('started_at', '<=', query.to);
  const rows = await qb;
  return { data: rows };
}

export async function handleCreate(req: AuthenticatedRequest) {
  const body = CreateBody.parse(req.body);
  const start = new Date(body.started_at).getTime();
  const end = new Date(body.ended_at).getTime();
  if (end <= start) {
    throw new AppError(400, 'ended_at must be after started_at');
  }
  const durationMinutes = Math.round((end - start) / 60000);

  const [row] = await tdb('time_entries')
    .insert({
      org_id: req.org!.id,
      client_id: body.client_id ?? null,
      description: body.description,
      started_at: new Date(body.started_at),
      ended_at: new Date(body.ended_at),
      duration_minutes: durationMinutes,
      hourly_rate_cents: body.hourly_rate_cents ?? null,
    })
    .returning('*');

  const warnings: string[] = [];
  if (!body.client_id) {
    warnings.push('Time entry is not assigned to a client. No automated processing will occur.');
  }

  return { data: { entry: row, ...(warnings.length ? { warnings } : {}) } };
}

router.get(
  '/',
  tenantScope(async (req, res) => {
    res.json(await handleList(req));
  })
);

router.post(
  '/',
  tenantScope(async (req, res) => {
    const result = await handleCreate(req);
    res.status(201).json(result);
  })
);

export default router;
export { CreateBody as CreateTimeEntryBody };

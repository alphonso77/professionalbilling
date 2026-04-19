import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { db } from '../config/database';
import { AppError } from '../middleware/error-handler';
import { tenantScope } from '../middleware/tenant-scope';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const FeedbackTypeEnum = z.enum(['bug', 'feature', 'ui', 'other']);
const FeedbackStatusEnum = z.enum([
  'pending',
  'acknowledged',
  'clarification_requested',
  'resolved',
]);

const FeedbackSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid().nullable(),
    user_id: z.string().uuid().nullable(),
    submitter_email: z.string().email().nullable(),
    org_name: z.string().nullable(),
    type: FeedbackTypeEnum,
    subject: z.string(),
    body: z.string(),
    status: FeedbackStatusEnum,
    admin_note: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('Feedback');

const CreateFeedbackBody = z
  .object({
    type: FeedbackTypeEnum,
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
  })
  .openapi('CreateFeedbackBody');

const ListResponse = z.object({ data: z.array(FeedbackSchema) });
const OneResponse = z.object({ data: FeedbackSchema });

const FEEDBACK_COLUMNS = [
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
  path: '/api/feedback',
  tags: ['feedback'],
  summary: "List the caller's own feedback submissions",
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Feedback', content: { 'application/json': { schema: ListResponse } } },
    401: { description: 'Not authenticated' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/feedback',
  tags: ['feedback'],
  summary: 'Submit feedback',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { body: { content: { 'application/json': { schema: CreateFeedbackBody } } } },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: OneResponse } } },
    400: { description: 'Validation error' },
    401: { description: 'Not authenticated' },
  },
});

export async function handleList(req: AuthenticatedRequest) {
  if (!req.userId) throw new AppError(401, 'Authentication required');
  const rows = await db('corporate.feedback')
    .where({ user_id: req.userId })
    .select(FEEDBACK_COLUMNS)
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleCreate(req: AuthenticatedRequest) {
  if (!req.userId) throw new AppError(401, 'Authentication required');
  const body = CreateFeedbackBody.parse(req.body);
  const orgId = req.org!.id;

  const userRow = (await db('users')
    .where({ id: req.userId })
    .select('email')
    .first()) as { email: string | null } | undefined;
  const orgRow = (await db('organizations')
    .where({ id: orgId })
    .select('name')
    .first()) as { name: string } | undefined;

  const [row] = await db('corporate.feedback')
    .insert({
      org_id: orgId,
      user_id: req.userId,
      submitter_email: userRow?.email ?? null,
      org_name: orgRow?.name ?? null,
      type: body.type,
      subject: body.subject,
      body: body.body,
    })
    .returning(FEEDBACK_COLUMNS);
  return { data: row };
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
export { CreateFeedbackBody, FeedbackSchema, FeedbackTypeEnum, FeedbackStatusEnum };

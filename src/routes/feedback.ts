import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { tdb } from '../config/tenant-context';
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
    org_id: z.string().uuid(),
    user_id: z.string().uuid(),
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
  const rows = await tdb('feedback')
    .where({ user_id: req.userId, org_id: req.org!.id })
    .select(FEEDBACK_COLUMNS)
    .orderBy('created_at', 'desc');
  return { data: rows };
}

export async function handleCreate(req: AuthenticatedRequest) {
  if (!req.userId) throw new AppError(401, 'Authentication required');
  const body = CreateFeedbackBody.parse(req.body);
  const [row] = await tdb('feedback')
    .insert({
      org_id: req.org!.id,
      user_id: req.userId,
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

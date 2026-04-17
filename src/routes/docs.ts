import { Router } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { db } from '../config/database';

const router = Router();

const DocsResponse = z.object({
  data: z.object({
    categories: z.array(
      z.object({
        key: z.string(),
        title: z.string(),
        description: z.string().optional(),
        entries: z.array(
          z.object({
            key: z.string(),
            label: z.string(),
            tooltip: z.string().optional(),
            detail: z.string().optional(),
            docSlug: z.string().optional(),
            whatWeMeasure: z.string().optional(),
          })
        ),
      })
    ),
  }),
});

registry.registerPath({
  method: 'get',
  path: '/api/docs',
  tags: ['docs'],
  summary: 'Single source of truth for UI guidance',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: {
      description: 'The docs registry (shared across tenants)',
      content: { 'application/json': { schema: DocsResponse } },
    },
  },
});

// Global registry lives in `corporate` schema — use superuser db (bypasses RLS).
export async function loadDocsRegistry(): Promise<unknown> {
  const row = await db('corporate.docs_registry').where({ id: 1 }).select('data').first();
  return row?.data ?? { categories: [] };
}

router.get('/', async (_req, res, next) => {
  try {
    const data = await loadDocsRegistry();
    res.json({ data });
  } catch (err) {
    next(err);
  }
});

export default router;

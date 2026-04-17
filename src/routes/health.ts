import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { registry } from '../openapi/registry';

const router = Router();

const HealthResponse = z.object({
  status: z.literal('ok'),
  version: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Liveness probe',
  responses: {
    200: {
      description: 'Service is up',
      content: { 'application/json': { schema: HealthResponse } },
    },
  },
});

router.get('/', (_req: Request, res: Response) => {
  res.json({ status: 'ok', version: process.env.npm_package_version || '0.1.0' });
});

export default router;

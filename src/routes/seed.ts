import { Router } from 'express';
import { z } from 'zod';

import { registry } from '../openapi/registry';
import { requireEasterEgg } from '../middleware/require-easter-egg';
import { tdb } from '../config/tenant-context';
import { hasSeededData, removeSeeded, run, type SeedSummary } from '../services/seed-builder';
import { AppError } from '../middleware/error-handler';
import { isStripeTestMode } from '../utils/stripe-mode';

const router = Router();

const SeedSummarySchema = z
  .object({
    clients: z.number().int(),
    time_entries: z.number().int(),
    invoices: z.number().int(),
    adopted: z.number().int(),
  })
  .openapi('SeedSummary');

const SeedResponse = z.object({ data: SeedSummarySchema });

registry.registerPath({
  method: 'post',
  path: '/api/seed',
  tags: ['seed'],
  summary: 'Seed realistic demo data (easter-egg only)',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    201: { description: 'Seeded', content: { 'application/json': { schema: SeedResponse } } },
    403: { description: 'Forbidden' },
    409: { description: 'Already seeded' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/seed/reseed',
  tags: ['seed'],
  summary: 'Remove existing seed data and re-seed',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    201: { description: 'Reseeded', content: { 'application/json': { schema: SeedResponse } } },
    403: { description: 'Forbidden' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/seed',
  tags: ['seed'],
  summary: 'Delete all seeded rows',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  responses: {
    200: { description: 'Deleted', content: { 'application/json': { schema: SeedResponse } } },
    403: { description: 'Forbidden' },
  },
});

function assertStripeTestMode(): void {
  if (!isStripeTestMode()) {
    throw new AppError(
      400,
      'Seeding requires Stripe test mode. Set STRIPE_SECRET_KEY to sk_test_… and redeploy.',
      'SEED_REQUIRES_TEST_MODE'
    );
  }
}

export async function handleSeed(orgId: string, t = tdb): Promise<{ seeded: boolean; summary: SeedSummary }> {
  assertStripeTestMode();
  if (await hasSeededData(orgId, t)) {
    return {
      seeded: false,
      summary: { clients: 0, time_entries: 0, invoices: 0, adopted: 0 },
    };
  }
  const summary = await run(orgId, t);
  return { seeded: true, summary };
}

export async function handleReseed(orgId: string, t = tdb): Promise<SeedSummary> {
  assertStripeTestMode();
  await removeSeeded(orgId, t);
  return run(orgId, t);
}

export async function handleRemoveSeed(orgId: string, t = tdb): Promise<SeedSummary> {
  return removeSeeded(orgId, t);
}

router.post(
  '/',
  requireEasterEgg(async (req, res) => {
    const { seeded, summary } = await handleSeed(req.org!.id);
    if (!seeded) {
      res.status(409).json({
        error: { message: 'Already seeded — re-seed or remove first', code: 'ALREADY_SEEDED' },
      });
      return;
    }
    res.status(201).json({ data: summary });
  })
);

router.post(
  '/reseed',
  requireEasterEgg(async (req, res) => {
    const summary = await handleReseed(req.org!.id);
    res.status(201).json({ data: summary });
  })
);

router.delete(
  '/',
  requireEasterEgg(async (req, res) => {
    const summary = await handleRemoveSeed(req.org!.id);
    res.json({ data: summary });
  })
);

export default router;

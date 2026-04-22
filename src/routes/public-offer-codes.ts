import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { registry } from '../openapi/registry';
import { logger } from '../utils/logger';
import { redeemOfferCode } from '../services/offer-codes';
import { AppError } from '../middleware/error-handler';

const RedeemBody = z
  .object({
    code: z.string().regex(/^[0-9]{6}$/, '6-digit code required'),
    email: z.string().email(),
  })
  .openapi('RedeemOfferCodeBody');

const RedeemResponse = z.object({ data: z.object({ ok: z.literal(true) }) });

registry.registerPath({
  method: 'post',
  path: '/api/public/offer-codes/redeem',
  tags: ['public'],
  summary: 'Redeem an offer code — unauthenticated',
  description:
    'On a valid code, sends a Clerk invitation email to the provided address. ' +
    'Rate-limited per-IP. Failure messages are intentionally generic to prevent ' +
    'code-probing (invalid vs expired vs exhausted all return the same 400).',
  request: {
    body: { content: { 'application/json': { schema: RedeemBody } } },
  },
  responses: {
    200: {
      description: 'Invitation queued',
      content: { 'application/json': { schema: RedeemResponse } },
    },
    400: { description: 'Invalid code / bad payload' },
    429: { description: 'Rate-limited' },
    503: { description: 'Clerk not configured' },
  },
});

const limiter = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests' },
});

const router = Router();

router.post('/redeem', limiter, async (req: Request, res: Response, next: NextFunction) => {
  const parsed = RedeemBody.safeParse(req.body);
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: { message: 'Invalid offer code', code: 'INVALID_CODE' } });
  }

  try {
    await redeemOfferCode({
      code: parsed.data.code,
      email: parsed.data.email,
      ip: typeof req.ip === 'string' ? req.ip : null,
    });
    res.json({ data: { ok: true } });
  } catch (err) {
    if (err instanceof AppError) return next(err);
    logger.error('offer-code redeem failed', { err: (err as Error).message });
    next(new AppError(503, 'Redemption unavailable', 'REDEMPTION_UNAVAILABLE'));
  }
});

export default router;

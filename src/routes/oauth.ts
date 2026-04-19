import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import axios from 'axios';
import { z } from 'zod';
import { registry } from '../openapi/registry';
import { db } from '../config/database';
import { redis } from '../config/redis';
import { encrypt } from '../utils/crypto';
import { env } from '../config/env';
import { requireOrg } from '../middleware/auth';
import { tenantScope } from '../middleware/tenant-scope';
import { tdb } from '../config/tenant-context';
import { AppError } from '../middleware/error-handler';
import { logger } from '../utils/logger';
import type { AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const OAUTH_STATE_TTL_SECONDS = 600;

interface OAuthState {
  orgId: string;
  platform: 'stripe';
}

async function saveState(state: string, data: OAuthState): Promise<void> {
  await redis.set(`oauth:state:${state}`, JSON.stringify(data), 'EX', OAUTH_STATE_TTL_SECONDS);
}

async function consumeState(state: string): Promise<OAuthState | null> {
  const raw = await redis.get(`oauth:state:${state}`);
  if (!raw) return null;
  await redis.del(`oauth:state:${state}`);
  return JSON.parse(raw);
}

const AuthorizeParams = z.object({ platform: z.literal('stripe') });
const AuthorizeResponse = z.object({ data: z.object({ url: z.string().url() }) });

registry.registerPath({
  method: 'post',
  path: '/api/oauth/authorize/{platform}',
  tags: ['oauth'],
  summary: 'Begin Stripe Connect authorization',
  security: [{ bearerAuth: [] }, { orgIdHeader: [] }],
  request: { params: AuthorizeParams },
  responses: {
    200: {
      description: 'Authorize URL',
      content: { 'application/json': { schema: AuthorizeResponse } },
    },
    409: { description: 'Already connected' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/oauth/callback/{platform}',
  tags: ['oauth'],
  summary: 'Stripe Connect OAuth redirect target',
  request: { params: AuthorizeParams },
  responses: {
    302: { description: 'Redirects to frontend with ?connected=stripe or ?error=...' },
  },
});

router.post(
  '/authorize/:platform',
  requireOrg(),
  tenantScope(async (req, res) => {
    const { platform } = AuthorizeParams.parse(req.params);
    if (platform !== 'stripe') {
      throw new AppError(400, `Unsupported OAuth platform: ${platform}`);
    }
    if (!env.STRIPE_CLIENT_ID) {
      throw new AppError(500, 'Stripe Connect not configured (STRIPE_CLIENT_ID missing)');
    }

    const existing = await tdb('platforms').where({ type: 'stripe', org_id: req.org!.id }).first();
    if (existing) throw new AppError(409, 'Stripe is already connected for this org');

    const state = crypto.randomBytes(32).toString('hex');
    await saveState(state, { orgId: req.org!.id, platform: 'stripe' });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: env.STRIPE_CLIENT_ID,
      scope: 'read_write',
      redirect_uri: env.STRIPE_CONNECT_REDIRECT_URI,
      state,
      stripe_landing: 'login',
    });

    const url = `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
    res.json({ data: { url } });
  })
);

interface StripeTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string;
  stripe_user_id: string;
  livemode: boolean;
  token_type: string;
}

async function exchangeStripeCode(code: string): Promise<StripeTokenResponse> {
  const response = await axios.post<StripeTokenResponse>(
    'https://connect.stripe.com/oauth/token',
    new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    {
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );
  return response.data;
}

router.get(
  '/callback/:platform',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { platform } = AuthorizeParams.parse(req.params);
      const { code, state, error, error_description } = req.query;

      if (error) {
        logger.warn(`OAuth ${platform} provider error`, { error, error_description });
        return res.redirect(
          `${env.FRONTEND_URL}/settings/integrations?error=${encodeURIComponent(
            String(error_description || error)
          )}`
        );
      }

      if (!code || !state) throw new AppError(400, 'Missing code or state parameter');

      const pending = await consumeState(state as string);
      if (!pending || pending.platform !== platform) {
        throw new AppError(400, 'Invalid or expired OAuth state');
      }

      const tokens = await exchangeStripeCode(code as string);

      const credentials = JSON.stringify({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope,
        stripe_user_id: tokens.stripe_user_id,
        livemode: tokens.livemode,
      });
      const enc = encrypt(credentials);

      await db('platforms')
        .insert({
          org_id: pending.orgId,
          type: 'stripe',
          external_account_id: tokens.stripe_user_id,
          credentials_encrypted: Buffer.from(enc.encrypted, 'base64'),
          credentials_iv: Buffer.from(enc.iv, 'hex'),
          credentials_tag: Buffer.from(enc.tag, 'hex'),
        })
        .onConflict(['type', 'external_account_id'])
        .merge({
          org_id: pending.orgId,
          credentials_encrypted: Buffer.from(enc.encrypted, 'base64'),
          credentials_iv: Buffer.from(enc.iv, 'hex'),
          credentials_tag: Buffer.from(enc.tag, 'hex'),
          updated_at: db.fn.now(),
        });

      logger.info('Stripe Connect linked', {
        orgId: pending.orgId,
        stripe_user_id: tokens.stripe_user_id,
      });

      res.redirect(`${env.FRONTEND_URL}/settings/integrations?connected=stripe`);
    } catch (err) {
      next(err);
    }
  }
);

export default router;

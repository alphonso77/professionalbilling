import { Response, RequestHandler } from 'express';

import { tdb } from '../config/tenant-context';
import type { AuthenticatedRequest } from './auth';
import { tenantScope } from './tenant-scope';

type TenantHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

/**
 * Wraps a tenant-scoped handler with a gate that requires
 * `users.easter_egg_enabled = true` for the caller. 403s are deliberately
 * opaque — callers must not be able to tell this is an easter-egg-gated
 * endpoint vs. any other missing-permission denial.
 */
export function requireEasterEgg(handler: TenantHandler): RequestHandler {
  return tenantScope(async (req, res) => {
    if (!req.userId) {
      res.status(401).json({ error: { message: 'Authentication required' } });
      return;
    }
    const row = (await tdb('users')
      .where({ id: req.userId })
      .select('easter_egg_enabled')
      .first()) as { easter_egg_enabled: boolean } | undefined;
    if (!row?.easter_egg_enabled) {
      res.status(403).json({ error: { message: 'Forbidden', code: 'FORBIDDEN' } });
      return;
    }
    return handler(req, res);
  });
}

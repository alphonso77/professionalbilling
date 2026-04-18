import { Response, RequestHandler } from 'express';

import { tdb } from '../config/tenant-context';
import type { AuthenticatedRequest } from './auth';
import { AppError } from './error-handler';
import { tenantScope } from './tenant-scope';

type TenantHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

export function requireEasterEgg(handler: TenantHandler): RequestHandler {
  return tenantScope(async (req, res) => {
    if (!req.userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
    }
    const row = (await tdb('users')
      .where({ id: req.userId })
      .select('easter_egg_enabled')
      .first()) as { easter_egg_enabled: boolean } | undefined;
    if (!row?.easter_egg_enabled) {
      throw new AppError(403, 'Forbidden', 'FORBIDDEN');
    }
    return handler(req, res);
  });
}

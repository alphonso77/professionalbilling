import type { Response, RequestHandler } from 'express';
import { db } from '../config/database';
import { AppError } from './error-handler';
import { tenantScope } from './tenant-scope';
import type { AuthenticatedRequest } from './auth';

type SuperAdminHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

/**
 * Wraps `tenantScope` and additionally asserts the caller's `users.is_super_admin`
 * is true. The check uses the raw (superuser) `db` pool because super-admin
 * status is global — not scoped to any single org — and the surfaces gated by
 * this middleware (cross-org product feedback, cross-org user listing) are
 * intentionally outside the multi-tenant boundary.
 */
export function requireSuperAdmin(handler: SuperAdminHandler): RequestHandler {
  return tenantScope(async (req, res) => {
    if (!req.userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
    }
    const row = (await db('users')
      .where({ id: req.userId })
      .select('is_super_admin')
      .first()) as { is_super_admin: boolean } | undefined;
    if (!row?.is_super_admin) {
      throw new AppError(403, 'Super-admin only', 'NOT_SUPER_ADMIN');
    }
    return handler(req, res);
  });
}

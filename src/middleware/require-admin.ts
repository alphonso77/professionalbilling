import type { Response, NextFunction, RequestHandler } from 'express';
import { tdb } from '../config/tenant-context';
import { AppError } from './error-handler';
import { tenantScope } from './tenant-scope';
import type { AuthenticatedRequest } from './auth';

type AdminHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

/**
 * Wraps `tenantScope` and additionally asserts the caller's `users.is_admin`
 * is true. Emits 401 / 403 with a structured `{ error: { message, code } }`
 * body so the frontend can react to specific codes.
 */
export function requireAdmin(handler: AdminHandler): RequestHandler {
  return tenantScope(async (req, res) => {
    if (!req.userId) {
      throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
    }
    const row = (await tdb('users')
      .where({ id: req.userId })
      .select('is_admin')
      .first()) as { is_admin: boolean } | undefined;
    if (!row?.is_admin) {
      throw new AppError(403, 'Admin only', 'FORBIDDEN');
    }
    return handler(req, res);
  });
}

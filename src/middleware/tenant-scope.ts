import { Response, NextFunction, RequestHandler } from 'express';
import { dbApp } from '../config/database';
import { runWithTenantContext } from '../config/tenant-context';
import type { AuthenticatedRequest } from './auth';
import { AppError } from './error-handler';

type TenantHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

/**
 * Wraps an async handler in a tenant-scoped Knex transaction.
 *
 * Opens a `dbApp` transaction, issues `SET LOCAL app.current_org_id = '<uuid>'`
 * so Postgres RLS policies filter by org, then runs the handler inside an
 * AsyncLocalStorage context so nested code can call `tdb('table')`.
 */
export function tenantScope(handler: TenantHandler): RequestHandler {
  return async (req, res, next) => {
    const r = req as AuthenticatedRequest;
    if (!r.org?.id) {
      return next(new AppError(500, 'tenantScope() requires requireOrg() to run first'));
    }
    const orgId = r.org.id;
    try {
      await dbApp.transaction(async (trx) => {
        await trx.raw(`SELECT set_config('app.current_org_id', ?, true)`, [orgId]);
        await runWithTenantContext({ orgId, trx }, () => handler(r, res) as Promise<unknown>);
      });
    } catch (err) {
      next(err);
    }
  };
}

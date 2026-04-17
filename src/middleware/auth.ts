import { Request, Response, NextFunction } from 'express';
import { clerkMiddleware, getAuth } from '@clerk/express';
import { db } from '../config/database';
import { AppError } from './error-handler';

export interface AuthenticatedRequest extends Request {
  org?: {
    id: string;
    clerk_org_id: string;
    plan: string;
  };
  userId?: string;
  userEmail?: string;
}

export function clerkSession() {
  return clerkMiddleware();
}

/**
 * Resolve org context from Clerk auth, with an x-org-id dev fallback.
 * Must run after clerkSession().
 */
export function requireOrg() {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const auth = getAuth(req);

      if (auth?.userId) {
        if (auth.orgId) {
          const org = await db('organizations')
            .where({ clerk_org_id: auth.orgId })
            .select('id', 'clerk_org_id', 'plan')
            .first();
          if (org) {
            req.org = { id: org.id, clerk_org_id: org.clerk_org_id, plan: org.plan };
            const user = await db('users')
              .where({ clerk_user_id: auth.userId })
              .select('id', 'email')
              .first();
            req.userId = user?.id;
            req.userEmail = user?.email;
            return next();
          }
        }

        const user = await db('users')
          .where({ clerk_user_id: auth.userId })
          .select('id', 'org_id', 'email')
          .first();
        if (user?.org_id) {
          const org = await db('organizations')
            .where({ id: user.org_id })
            .select('id', 'clerk_org_id', 'plan')
            .first();
          if (org) {
            req.org = { id: org.id, clerk_org_id: org.clerk_org_id, plan: org.plan };
            req.userId = user.id;
            req.userEmail = user.email;
            return next();
          }
        }
      }

      if (process.env.NODE_ENV !== 'production') {
        const xOrgId = req.headers['x-org-id'] as string | undefined;
        if (xOrgId) {
          const org = await db('organizations')
            .where({ id: xOrgId })
            .select('id', 'clerk_org_id', 'plan')
            .first();
          if (org) {
            req.org = { id: org.id, clerk_org_id: org.clerk_org_id, plan: org.plan };
            const xUserId = req.headers['x-user-id'] as string | undefined;
            if (xUserId) req.userId = xUserId;
            return next();
          }
        }
      }

      throw new AppError(401, 'Authentication required');
    } catch (err) {
      next(err);
    }
  };
}

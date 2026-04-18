import express, { Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/error-handler';
import { clerkSession, requireOrg } from './middleware/auth';

// Eagerly import each route so its OpenAPI registrations land in the registry
// before we build the doc.
import healthRoutes from './routes/health';
import webhookRoutes from './routes/webhooks';
import stripeWebhookRouter from './routes/stripe-webhook';
import oauthRoutes from './routes/oauth';
import docsRoutes from './routes/docs';
import meRoutes from './routes/me';
import clientsRoutes from './routes/clients';
import timeEntriesRoutes from './routes/time-entries';
import platformsRoutes from './routes/platforms';
import invoicesRoutes from './routes/invoices';
import publicInvoicesRoutes from './routes/public-invoices';
import adminRoutes from './routes/admin';
import seedRoutes from './routes/seed';
import { generateOpenApiDocument } from './openapi/generate';

const app = express();
app.set('trust proxy', 1);

// ---- Global middleware ----
app.use(helmet({ contentSecurityPolicy: false }));
app.use(
  compression({
    filter: (req, res) => {
      if (res.getHeader('Content-Type') === 'text/event-stream') return false;
      return compression.filter(req, res);
    },
  })
);
app.use(
  morgan('short', {
    stream: { write: (msg: string) => logger.info(msg.trim()) },
  })
);
app.use(
  cors({
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  })
);

// Stripe webhooks need the raw body for signature verification — mount the raw
// parser + router BEFORE express.json so the global JSON parser doesn't consume it.
app.use(
  '/api/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '1mb' }),
  stripeWebhookRouter
);

app.use(express.json({ limit: '1mb' }));

const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.path === '/health' || req.path.startsWith('/api/swagger') || req.path === '/api/openapi.json',
});
app.use(globalLimiter);

// Clerk middleware attaches auth state but does not enforce it.
app.use(clerkSession());

// ---- Public routes ----
app.use('/health', healthRoutes);

app.get('/api/openapi.json', (_req: Request, res: Response) => {
  res.json(generateOpenApiDocument());
});
app.use(
  '/api/swagger',
  swaggerUi.serve,
  swaggerUi.setup(undefined, {
    swaggerOptions: {
      url: '/api/openapi.json',
      persistAuthorization: true,
    },
  })
);

// ---- Webhooks (signature-verified; NO requireOrg) ----
app.use('/api/webhooks', webhookRoutes);

// ---- OAuth: authorize requires org (enforced inside the router),
// callback is a provider redirect — org context comes from the state param. ----
app.use('/api/oauth', oauthRoutes);

// ---- Public payment route (no Clerk auth; token-gated). Must be mounted
// BEFORE the authenticated routes so `/api/public/...` bypasses requireOrg. ----
app.use('/api/public', publicInvoicesRoutes);

// ---- Tenant-scoped routes ----
app.use('/api/me', requireOrg(), meRoutes);
app.use('/api/docs', requireOrg(), docsRoutes);
app.use('/api/clients', requireOrg(), clientsRoutes);
app.use('/api/time-entries', requireOrg(), timeEntriesRoutes);
app.use('/api/platforms', requireOrg(), platformsRoutes);
app.use('/api/invoices', requireOrg(), invoicesRoutes);
app.use('/api/admin', requireOrg(), adminRoutes);
app.use('/api/seed', requireOrg(), seedRoutes);

// ---- Error handler (last) ----
app.use(errorHandler);

app.listen(env.PORT, () => {
  logger.info(`Professional Billing API on http://localhost:${env.PORT}`, {
    env: env.NODE_ENV,
    swagger: `${env.API_BASE_URL}/api/swagger`,
  });
});

export default app;

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),

  API_BASE_URL: z.string().default('http://localhost:3000'),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().url(),
  DATABASE_APP_URL: z.string().url().optional(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  CLERK_SECRET_KEY: z.string().optional(),
  CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_WEBHOOK_SIGNING_SECRET: z.string().optional(),

  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_CLIENT_ID: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_CONNECT_REDIRECT_URI: z
    .string()
    .default('http://localhost:3000/api/oauth/callback/stripe'),

  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z
    .string()
    .default('no-reply@professionalbilling.fratellisoftware.com'),

  ENCRYPTION_KEY: z
    .string()
    .length(64, 'Must be 32 bytes as hex (64 chars). Generate: openssl rand -hex 32')
    .optional(),

  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.format());
    process.exit(1);
  }
  const data = result.data;

  const requiredInProd: Array<keyof Env> = [
    'CLERK_SECRET_KEY',
    'CLERK_PUBLISHABLE_KEY',
    'CLERK_WEBHOOK_SIGNING_SECRET',
    'ENCRYPTION_KEY',
  ];
  if (data.NODE_ENV === 'production') {
    const missing = requiredInProd.filter((k) => !data[k]);
    if (missing.length) {
      console.error(`Missing required env vars in production: ${missing.join(', ')}`);
      process.exit(1);
    }
  } else {
    const missing = requiredInProd.filter((k) => !data[k]);
    if (missing.length) {
      console.warn(`[env] Missing (dev): ${missing.join(', ')} — some features will be disabled.`);
    }
  }

  return data;
}

export const env = validateEnv();

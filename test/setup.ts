process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.DATABASE_APP_URL =
  process.env.DATABASE_APP_URL || process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy';
process.env.STRIPE_CLIENT_ID = process.env.STRIPE_CLIENT_ID || 'ca_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_dummy';

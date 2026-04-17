process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.DATABASE_APP_URL =
  process.env.DATABASE_APP_URL || process.env.DATABASE_URL;
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

import knex, { Knex } from 'knex';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require('../../datastore/knexfile.js');

const environment = process.env.NODE_ENV || 'development';
const config: Knex.Config | undefined = knexConfig[environment];

if (!config) {
  throw new Error(`No database configuration found for environment: ${environment}`);
}

/**
 * Superuser connection — migrations, workers, admin paths (bypasses RLS).
 */
export const db: Knex = knex(config);

/**
 * App-role connection — API handlers (RLS enforced).
 * Connects as `professionalbilling_app` when DATABASE_APP_URL is set,
 * otherwise falls back to the superuser connection (dev only).
 */
const appConfig: Knex.Config = { ...config };
if (process.env.DATABASE_APP_URL) {
  if (environment === 'production') {
    appConfig.connection = {
      connectionString: process.env.DATABASE_APP_URL,
      ssl: { rejectUnauthorized: false },
    };
  } else {
    appConfig.connection = process.env.DATABASE_APP_URL;
  }
}

export const dbApp: Knex = knex(appConfig);

export default db;

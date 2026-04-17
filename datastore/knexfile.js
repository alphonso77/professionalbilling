const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const migrations = {
  directory: path.resolve(__dirname, 'migrations'),
  extension: 'js',
  loadExtensions: ['.js'],
};

module.exports = {
  development: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations,
    seeds: { directory: path.resolve(__dirname, 'seeds/development') },
    pool: { min: 2, max: 10 },
  },
  test: {
    client: 'pg',
    connection: process.env.DATABASE_URL,
    migrations,
    seeds: { directory: path.resolve(__dirname, 'seeds/development') },
    pool: { min: 1, max: 5 },
  },
  production: {
    client: 'pg',
    connection: {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    },
    migrations,
    seeds: { directory: path.resolve(__dirname, 'seeds/production') },
    pool: { min: 2, max: 20 },
  },
};

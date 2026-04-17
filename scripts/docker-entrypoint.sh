#!/bin/sh
# Docker entrypoint — routes by MODE: api | workers | migrate
set -e

MODE="${1:-api}"

run_migrations() {
  if [ "${SKIP_MIGRATIONS}" = "true" ]; then
    echo "Skipping migrations (SKIP_MIGRATIONS=true)"
    return
  fi
  echo "Running database migrations..."
  npx knex migrate:latest --knexfile datastore/knexfile.js
  echo "Migrations complete."
}

run_production_seeds() {
  if [ "${SKIP_SEEDS}" = "true" ]; then
    echo "Skipping production seeds (SKIP_SEEDS=true)"
    return
  fi
  echo "Running production seeds..."
  npx knex seed:run --knexfile datastore/knexfile.js --env production
  echo "Production seeds complete."
}

case "$MODE" in
  api)
    run_migrations
    run_production_seeds
    echo "Starting API server..."
    exec node dist/server.js
    ;;
  workers)
    run_migrations
    echo "Starting all workers..."
    # Derive worker list from package.json worker:* scripts (single source of truth).
    WORKER_FILES=$(node -e "
      const s = require('./package.json').scripts;
      Object.keys(s).filter(k => k.startsWith('worker:')).forEach(k => {
        console.log(s[k].replace('tsx src/', 'dist/').replace('.ts', '.js'));
      });
    ")
    WORKER_COUNT=0
    for cmd in $WORKER_FILES; do
      echo "  Starting: node $cmd"
      node "$cmd" &
      WORKER_COUNT=$((WORKER_COUNT + 1))
    done
    echo "Started $WORKER_COUNT workers."
    wait
    ;;
  migrate)
    run_migrations
    echo "Migration-only run complete. Exiting."
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: docker-entrypoint.sh {api|workers|migrate}"
    exit 1
    ;;
esac

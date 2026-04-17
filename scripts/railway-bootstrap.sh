#!/usr/bin/env bash
# One-time provisioning of a new Railway project for Professional Billing.
#
# Requires: `railway` CLI installed and `railway login` run first.
# Run from the repo root: ./scripts/railway-bootstrap.sh
#
# Provisions:
#   - Railway project "professionalbilling"
#   - Postgres + Redis plugins
#   - 3 services: api (railway.toml), workers (railway.workers.toml), frontend (railway.frontend.toml)
#   - Placeholder env vars for secrets — operator fills in real values via the dashboard.
#
# Known Railway CLI limitation: the per-service config file
# (railway.toml vs railway.workers.toml vs railway.frontend.toml) is set via
# the dashboard, not the CLI. That step is documented below.

set -euo pipefail

PROJECT_NAME="professionalbilling"

command -v railway >/dev/null 2>&1 || {
  echo "Error: 'railway' CLI not found. Install from https://docs.railway.com/guides/cli" >&2
  exit 1
}

echo "Creating Railway project: $PROJECT_NAME"
railway init -n "$PROJECT_NAME"

echo "Provisioning Postgres and Redis plugins..."
railway add --database postgres
railway add --database redis

echo "Creating services..."
railway add --service api
railway add --service workers
railway add --service frontend

echo "Setting placeholder env vars on api + workers (operator fills real values)..."
for var in CLERK_SECRET_KEY CLERK_PUBLISHABLE_KEY CLERK_WEBHOOK_SIGNING_SECRET \
           STRIPE_SECRET_KEY STRIPE_CLIENT_ID STRIPE_WEBHOOK_SECRET \
           STRIPE_CONNECT_REDIRECT_URI RESEND_API_KEY ENCRYPTION_KEY \
           DATABASE_APP_URL; do
  railway variables --set "$var=REPLACE_ME" --service api
  railway variables --set "$var=REPLACE_ME" --service workers
done

echo "Setting placeholder env vars on frontend..."
for var in VITE_CLERK_PUBLISHABLE_KEY VITE_API_BASE_URL; do
  railway variables --set "$var=REPLACE_ME" --service frontend
done

cat <<'EOF'

Done. Manual follow-up:
  1. In Railway dashboard → api service → Settings → set "Config as Code" path to "railway.toml"
  2. Same for workers → "railway.workers.toml"
  3. Same for frontend → "railway.frontend.toml"
  4. Create `professionalbilling_app` restricted DB role post-migration:
       CREATE ROLE professionalbilling_app LOGIN PASSWORD '...' NOBYPASSRLS;
       GRANT CONNECT ON DATABASE railway TO professionalbilling_app;
       -- remaining grants are applied by the create_app_role migration
     Then set DATABASE_APP_URL for api + workers.
  5. Replace REPLACE_ME placeholder env vars with real values.
  6. Configure custom domain: professionalbilling.fratellisoftware.com → frontend service.

EOF

#!/usr/bin/env bash
# =============================================================================
# Postgres self-host setup for DigitalOcean Droplet (Ubuntu 22.04 / 24.04)
#
# This installs Postgres 16, creates a database + user for the affiliate bot,
# locks down to localhost-only, and prints the connection string.
#
# Usage:
#   sudo bash scripts/setup-postgres.sh
#
# Idempotent — safe to re-run.
# =============================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-affiliate}"
DB_USER="${DB_USER:-botuser}"
PG_VERSION="${PG_VERSION:-16}"

# Generate strong password if not provided
if [ -z "${DB_PASSWORD:-}" ]; then
  DB_PASSWORD=$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)
  echo "→ Generated random password (will be saved to /root/research-2/.pg-password)"
fi

GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

log() { echo -e "${GREEN}▶${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Must run as root (or with sudo)${RESET}"
  exit 1
fi

# 1. Install Postgres if missing
if ! command -v psql >/dev/null 2>&1; then
  log "Installing Postgres ${PG_VERSION}..."
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg lsb-release

  if ! grep -q "apt.postgresql.org" /etc/apt/sources.list.d/pgdg.list 2>/dev/null; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
  fi

  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    "postgresql-${PG_VERSION}" "postgresql-client-${PG_VERSION}" \
    "postgresql-contrib-${PG_VERSION}"
else
  log "Postgres already installed ($(psql --version))"
fi

# 2. Start service
log "Starting Postgres service..."
systemctl enable --now postgresql

# 3. Create role + database (idempotent)
log "Creating role '${DB_USER}' and database '${DB_NAME}'..."

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
  ELSE
    ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}')
\gexec

GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
SQL

# Grant schema privileges (Postgres 15+ requires this)
sudo -u postgres psql -d "${DB_NAME}" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${DB_USER};
SQL

# 4. Lock down to localhost (default in Postgres 16, but verify)
PG_CONF_DIR="/etc/postgresql/${PG_VERSION}/main"
HBA_FILE="${PG_CONF_DIR}/pg_hba.conf"
PG_CONF="${PG_CONF_DIR}/postgresql.conf"

if [ -f "${PG_CONF}" ]; then
  log "Restricting to localhost..."
  sed -i "s/^#\?listen_addresses.*/listen_addresses = 'localhost'/" "${PG_CONF}"
fi

# 5. Optimize for small VPS (1-2GB RAM)
if [ -f "${PG_CONF}" ]; then
  log "Tuning Postgres for small VPS..."
  cat > "${PG_CONF_DIR}/conf.d/affiliate-tuning.conf" <<EOF
# Tuning for 1-2 GB RAM Droplet
shared_buffers = 256MB
effective_cache_size = 768MB
maintenance_work_mem = 64MB
work_mem = 4MB
max_connections = 50
checkpoint_completion_target = 0.9
random_page_cost = 1.1
effective_io_concurrency = 200
EOF
fi

# 6. Restart to apply config
log "Restarting Postgres..."
systemctl restart postgresql

# 7. Test connection
log "Testing connection..."
PGPASSWORD="${DB_PASSWORD}" psql -h localhost -U "${DB_USER}" -d "${DB_NAME}" -c "SELECT version();" >/dev/null
log "Connection OK"

# 8. Save password to file (for project to read)
PASSWORD_FILE="/root/research-2/.pg-password"
mkdir -p "$(dirname ${PASSWORD_FILE})"
cat > "${PASSWORD_FILE}" <<EOF
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
EOF
chmod 600 "${PASSWORD_FILE}"

# 9. Build connection string
DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@localhost:5432/${DB_NAME}?sslmode=disable"

# 10. Print summary
echo
echo -e "${GREEN}════════════════════════════════════════════════════${RESET}"
echo -e "${GREEN}  Postgres ready!${RESET}"
echo -e "${GREEN}════════════════════════════════════════════════════${RESET}"
echo
echo "Database: ${DB_NAME}"
echo "User:     ${DB_USER}"
echo "Password: (saved to ${PASSWORD_FILE})"
echo
echo "Add this line to /root/research-2/.env:"
echo
echo -e "${YELLOW}DATABASE_URL=${DATABASE_URL}${RESET}"
echo

# Optional: append to .env if it exists and DATABASE_URL is still placeholder
ENV_FILE="/root/research-2/.env"
if [ -f "${ENV_FILE}" ] && grep -q "DATABASE_URL=postgresql://placeholder" "${ENV_FILE}"; then
  log "Updating ${ENV_FILE} (DATABASE_URL was placeholder)..."
  sed -i "s|^DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "${ENV_FILE}"
  log "✓ DATABASE_URL set in .env"
fi

echo "Next steps:"
echo "  1. Verify with: bun run check-env"
echo "  2. Push schema: bun run db:push"
echo "  3. Seed data:   bun run db:seed"
echo

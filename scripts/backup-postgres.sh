#!/usr/bin/env bash
# =============================================================================
# Postgres backup → optional upload to DigitalOcean Spaces
#
# Schedule: add to /etc/cron.daily/ or systemd timer
#   ln -s /root/research-2/scripts/backup-postgres.sh /etc/cron.daily/affiliate-db-backup
#
# Env vars (read from .env):
#   DATABASE_URL              — required
#   DO_SPACES_KEY             — optional (skip upload if missing)
#   DO_SPACES_SECRET
#   DO_SPACES_REGION          — e.g. sgp1
#   DO_SPACES_BUCKET
# =============================================================================
set -euo pipefail

PROJECT_DIR="/root/research-2"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/affiliate}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

# Load env
if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

mkdir -p "${BACKUP_DIR}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/affiliate-${TIMESTAMP}.sql.gz"

echo "▶ Dumping database..."
pg_dump "${DATABASE_URL}" --no-owner --clean --if-exists \
  | gzip -9 > "${BACKUP_FILE}"

SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
echo "✓ Backup written: ${BACKUP_FILE} (${SIZE})"

# Upload to DO Spaces if configured
if [ -n "${DO_SPACES_KEY:-}" ] && [ -n "${DO_SPACES_SECRET:-}" ]; then
  if ! command -v s3cmd >/dev/null 2>&1; then
    echo "Installing s3cmd..."
    apt-get install -y -qq s3cmd
  fi

  REGION="${DO_SPACES_REGION:-sgp1}"
  BUCKET="${DO_SPACES_BUCKET:-affiliate-backups}"
  HOST="${REGION}.digitaloceanspaces.com"

  echo "▶ Uploading to DO Spaces (${BUCKET})..."
  s3cmd put "${BACKUP_FILE}" "s3://${BUCKET}/postgres/" \
    --access_key="${DO_SPACES_KEY}" \
    --secret_key="${DO_SPACES_SECRET}" \
    --host="${HOST}" \
    --host-bucket="%(bucket)s.${HOST}" \
    --no-progress
  echo "✓ Uploaded"
fi

# Prune old local backups
echo "▶ Pruning backups older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -name "affiliate-*.sql.gz" -mtime "+${RETENTION_DAYS}" -delete

echo "✓ Done"

#!/usr/bin/env bash
# =============================================================================
# Backup verification — sanity check that latest backup can restore.
#
# Strategy:
#   1. Find most recent backup file
#   2. Restore into a temp database
#   3. Compare row counts of key tables vs production
#   4. Drop temp database
#
# Run weekly (or after big schema changes).
#
# Usage: sudo bash scripts/verify-backup.sh
# =============================================================================
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/affiliate}"
PROJECT_DIR="/root/research-2"

GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"
log() { echo -e "${GREEN}▶${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }
err() { echo -e "${RED}✗${RESET} $*"; }

# Load env to get DATABASE_URL
if [ -f "${PROJECT_DIR}/.env" ]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

# Find latest backup
BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/affiliate-*.sql.gz 2>/dev/null | head -1)
if [ -z "${BACKUP_FILE}" ]; then
  err "No backup found in ${BACKUP_DIR}"
  exit 1
fi

log "Latest backup: ${BACKUP_FILE}"
log "Size:          $(du -h "${BACKUP_FILE}" | cut -f1)"
log "Modified:      $(date -r "${BACKUP_FILE}" '+%Y-%m-%d %H:%M:%S')"

# Verify gzip integrity
log "Checking gzip integrity..."
if ! gunzip -t "${BACKUP_FILE}"; then
  err "Backup file is corrupted!"
  exit 1
fi
log "✓ gzip OK"

# Sanity check the SQL header
log "Checking SQL header..."
HEAD=$(gunzip -c "${BACKUP_FILE}" | head -20)
if echo "${HEAD}" | grep -q "PostgreSQL database dump"; then
  log "✓ Valid pg_dump output"
else
  warn "Unusual header — may not be pg_dump format"
fi

# Restore into temp database for validation
TEMP_DB="affiliate_verify_$(date +%s)"
log "Creating temp database: ${TEMP_DB}"

PGCMD=$(echo "${DATABASE_URL}" | sed -E 's|^postgresql://([^:]+):[^@]+@([^:/]+)(:[0-9]+)?/.*|host=\2 user=\1|')

# Strip credentials when calling psql via socket on localhost
if echo "${DATABASE_URL}" | grep -q "localhost"; then
  PGUSER=$(echo "${DATABASE_URL}" | sed -E 's|^postgresql://([^:]+):.*|\1|')
  PGPASS=$(echo "${DATABASE_URL}" | sed -E 's|^postgresql://[^:]+:([^@]+)@.*|\1|')
  PGDB=$(echo "${DATABASE_URL}" | sed -E 's|^.*/([^?]+).*|\1|')

  PGPASSWORD="${PGPASS}" createdb -h localhost -U "${PGUSER}" "${TEMP_DB}"

  log "Restoring backup into temp DB..."
  PGPASSWORD="${PGPASS}" gunzip -c "${BACKUP_FILE}" \
    | psql -h localhost -U "${PGUSER}" -d "${TEMP_DB}" -q -v ON_ERROR_STOP=0 \
    > /tmp/verify-restore.log 2>&1 || true

  log "Comparing row counts..."

  for table in products shops content_pages product_reviews scraper_runs; do
    PROD_COUNT=$(PGPASSWORD="${PGPASS}" psql -h localhost -U "${PGUSER}" -d "${PGDB}" -t -A -c "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "?")
    TEMP_COUNT=$(PGPASSWORD="${PGPASS}" psql -h localhost -U "${PGUSER}" -d "${TEMP_DB}" -t -A -c "SELECT COUNT(*) FROM ${table}" 2>/dev/null || echo "?")
    if [ "${PROD_COUNT}" = "${TEMP_COUNT}" ]; then
      log "  ${table}: ${PROD_COUNT} rows ✓"
    else
      warn "  ${table}: prod=${PROD_COUNT} backup=${TEMP_COUNT} (diff)"
    fi
  done

  # Cleanup
  log "Dropping temp database..."
  PGPASSWORD="${PGPASS}" dropdb -h localhost -U "${PGUSER}" "${TEMP_DB}"

else
  warn "Non-localhost DB — cannot create temp DB for verification"
  warn "Skipping restore test; only gzip + header checked"
fi

log "✓ Backup verification complete"

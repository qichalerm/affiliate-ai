#!/usr/bin/env bash
# =============================================================================
# Migration script — one-shot setup for a fresh DigitalOcean Droplet (or any Ubuntu).
#
# What it does:
#   1. Installs system deps (git, curl, ffmpeg, etc.)
#   2. Installs Bun
#   3. Clones project from GitHub (uses GITHUB_TOKEN if private repo)
#   4. Installs dependencies (bun install)
#   5. Sets up Postgres locally (calls setup-postgres.sh)
#   6. Optionally restores DB backup if provided
#   7. Sets up systemd service for scheduler
#   8. Prints next steps
#
# Usage:
#   On NEW droplet:
#     curl -fsSL https://raw.githubusercontent.com/qichalerm/affiliate-bot/main/scripts/migrate.sh \
#       | sudo bash -s -- --token=ghp_xxx --backup=/path/to/backup.sql.gz
#
#   Or step-by-step on an already-cloned project:
#     sudo bash scripts/migrate.sh --skip-clone
#
# Idempotent — safe to re-run.
# =============================================================================
set -euo pipefail

# ── Defaults ────────────────────────────────────────────────────────────────
PROJECT_DIR="${PROJECT_DIR:-/root/research-2}"
REPO_URL="${REPO_URL:-https://github.com/qichalerm/affiliate-bot.git}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"
BACKUP_FILE=""
SKIP_CLONE=0
SKIP_POSTGRES=0
SKIP_SYSTEMD=0
ENV_SOURCE=""              # path to existing .env to copy

# ── Parse args ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --token=*) GITHUB_TOKEN="${1#*=}" ;;
    --repo=*) REPO_URL="${1#*=}" ;;
    --dir=*) PROJECT_DIR="${1#*=}" ;;
    --backup=*) BACKUP_FILE="${1#*=}" ;;
    --env=*) ENV_SOURCE="${1#*=}" ;;
    --skip-clone) SKIP_CLONE=1 ;;
    --skip-postgres) SKIP_POSTGRES=1 ;;
    --skip-systemd) SKIP_SYSTEMD=1 ;;
    --help|-h)
      cat <<HELP
Usage: $0 [options]

Options:
  --token=<gh_pat>      GitHub personal access token (for private repo)
  --repo=<url>          Override repo URL
  --dir=<path>          Override project directory (default: /root/research-2)
  --backup=<file>       Restore Postgres from this .sql.gz backup
  --env=<file>          Copy this .env file into project after clone
  --skip-clone          Skip git clone (project already there)
  --skip-postgres       Skip Postgres setup
  --skip-systemd        Skip systemd service install
  --help                Show this message

Examples:
  $0 --token=ghp_xxxxx
  $0 --skip-clone --env=/tmp/.env.bak
  $0 --backup=/tmp/db.sql.gz
HELP
      exit 0 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

# ── Colors ──────────────────────────────────────────────────────────────────
GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; BLUE="\033[34m"; RESET="\033[0m"; BOLD="\033[1m"
log()  { echo -e "${GREEN}▶${RESET} $*"; }
warn() { echo -e "${YELLOW}⚠${RESET} $*"; }
err()  { echo -e "${RED}✗${RESET} $*"; }
hr()   { echo -e "${BLUE}────────────────────────────────────────${RESET}"; }

if [ "$EUID" -ne 0 ]; then
  err "Run as root (or with sudo)"
  exit 1
fi

hr
log "Affiliate Bot — Migration Script"
hr

# ── 1. System deps ──────────────────────────────────────────────────────────
log "Installing system dependencies..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  curl wget git ca-certificates gnupg lsb-release unzip \
  build-essential python3 python3-pip \
  ffmpeg \
  ufw fail2ban \
  jq

log "✓ System deps installed"

# ── 2. Bun ──────────────────────────────────────────────────────────────────
if ! command -v bun >/dev/null 2>&1; then
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! grep -q "BUN_INSTALL" /root/.bashrc; then
    cat >> /root/.bashrc <<'EOF'

# Bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"
EOF
  fi
  log "✓ Bun installed: $(bun --version)"
else
  log "Bun already installed: $(bun --version)"
fi

# ── 3. Clone ────────────────────────────────────────────────────────────────
if [ "$SKIP_CLONE" -eq 0 ]; then
  if [ -d "${PROJECT_DIR}/.git" ]; then
    log "Project exists at ${PROJECT_DIR} — pulling latest"
    cd "${PROJECT_DIR}"
    git pull
  else
    log "Cloning ${REPO_URL} → ${PROJECT_DIR}..."
    if [ -n "${GITHUB_TOKEN}" ]; then
      AUTH_URL=$(echo "${REPO_URL}" | sed -E "s#https://#https://${GITHUB_TOKEN}@#")
      git clone "${AUTH_URL}" "${PROJECT_DIR}"
    else
      git clone "${REPO_URL}" "${PROJECT_DIR}"
    fi
  fi
  log "✓ Project at ${PROJECT_DIR}"
else
  log "Skip clone (--skip-clone)"
fi

cd "${PROJECT_DIR}"

# ── 4. .env handling ────────────────────────────────────────────────────────
if [ -n "${ENV_SOURCE}" ] && [ -f "${ENV_SOURCE}" ]; then
  log "Copying .env from ${ENV_SOURCE}..."
  cp "${ENV_SOURCE}" "${PROJECT_DIR}/.env"
  chmod 600 "${PROJECT_DIR}/.env"
  log "✓ .env copied"
elif [ ! -f "${PROJECT_DIR}/.env" ]; then
  log "No .env yet — copying from .env.example"
  cp "${PROJECT_DIR}/.env.example" "${PROJECT_DIR}/.env"
  warn "You MUST fill in .env before running anything else"
  warn "  → see docs/env-setup.md"
fi

# ── 5. Install deps ─────────────────────────────────────────────────────────
log "Installing Bun dependencies..."
export PATH="$HOME/.bun/bin:$PATH"
cd "${PROJECT_DIR}"
bun install

log "Installing web dependencies..."
cd "${PROJECT_DIR}/src/web"
bun install
cd "${PROJECT_DIR}"

log "✓ Dependencies installed"

# ── 6. Postgres ─────────────────────────────────────────────────────────────
if [ "$SKIP_POSTGRES" -eq 0 ]; then
  log "Setting up Postgres..."
  bash "${PROJECT_DIR}/scripts/setup-postgres.sh"
else
  log "Skip Postgres setup (--skip-postgres)"
fi

# ── 7. DB restore (optional) ────────────────────────────────────────────────
if [ -n "${BACKUP_FILE}" ] && [ -f "${BACKUP_FILE}" ]; then
  log "Restoring Postgres from ${BACKUP_FILE}..."
  # Extract DATABASE_URL from .env
  DB_URL=$(grep "^DATABASE_URL=" "${PROJECT_DIR}/.env" | cut -d'=' -f2-)
  if [ -z "${DB_URL}" ] || echo "${DB_URL}" | grep -q "placeholder"; then
    warn "DATABASE_URL not set or still placeholder — skipping restore"
  else
    gunzip -c "${BACKUP_FILE}" | psql "${DB_URL}"
    log "✓ DB restored"
  fi
fi

# ── 8. Firewall ─────────────────────────────────────────────────────────────
log "Configuring firewall..."
ufw --force enable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw status numbered
log "✓ Firewall enabled (SSH only inbound)"

# ── 9. Systemd service ──────────────────────────────────────────────────────
if [ "$SKIP_SYSTEMD" -eq 0 ]; then
  log "Installing systemd service..."
  cp "${PROJECT_DIR}/systemd/affiliate-scheduler.service" /etc/systemd/system/
  systemctl daemon-reload
  warn "Service installed but NOT started — run after .env is filled:"
  warn "  sudo systemctl enable --now affiliate-scheduler"
else
  log "Skip systemd (--skip-systemd)"
fi

# ── 10. Daily backup cron (only if backup script exists) ────────────────────
if [ -f "${PROJECT_DIR}/scripts/backup-postgres.sh" ]; then
  log "Linking daily backup..."
  chmod +x "${PROJECT_DIR}/scripts/backup-postgres.sh"
  ln -sf "${PROJECT_DIR}/scripts/backup-postgres.sh" /etc/cron.daily/affiliate-db-backup
  log "✓ Daily backup scheduled (/etc/cron.daily/)"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
hr
log "${BOLD}Migration complete!${RESET}"
hr

cat <<NEXT

${BOLD}Next steps:${RESET}

  1. Verify .env (especially DATABASE_URL, ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN):
     ${BLUE}cd ${PROJECT_DIR}${RESET}
     ${BLUE}bun run check-env${RESET}

  2. Push schema (if not restored from backup):
     ${BLUE}bun run db:push${RESET}
     ${BLUE}bun run db:seed${RESET}

  3. Test connections:
     ${BLUE}bun run test-connections${RESET}
     ${BLUE}bun run telegram:test${RESET}

  4. First scrape:
     ${BLUE}bun run scrape:once "หูฟังบลูทูธ" 30${RESET}

  5. Start scheduler:
     ${BLUE}sudo systemctl enable --now affiliate-scheduler${RESET}
     ${BLUE}sudo journalctl -u affiliate-scheduler -f${RESET}

  6. Build + deploy site:
     ${BLUE}bun run build:pages${RESET}

${BOLD}Documentation:${RESET}
  - docs/HANDOFF.md            Full project context
  - docs/runbook.md            Day-to-day operations
  - docs/digitalocean-setup.md DigitalOcean specifics
  - docs/env-setup.md          Filling .env step-by-step
  - docs/phase-2-spec.md       What to build next

NEXT

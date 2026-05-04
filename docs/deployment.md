# Deployment Guide

Two supported paths: **Docker** (recommended for any new server) and **bare metal** (current DO Droplet).

## Path A: Docker (recommended)

### One-time setup on fresh server

```bash
# 1. Install Docker on Ubuntu/Debian
curl -fsSL https://get.docker.com | sudo bash
sudo systemctl enable --now docker

# 2. Clone project
git clone https://<TOKEN>@github.com/<your-username>/affiliate-bot.git /root/research-2
cd /root/research-2

# 3. Fill .env
cp .env.example .env
nano .env  # set DOMAIN_NAME, DATABASE_URL, ANTHROPIC_API_KEY, etc.

# Note: when using docker-compose, DATABASE_URL is overridden
# automatically to point at the postgres service.
# But you still need DB_USER + DB_PASSWORD in .env.

# 4. Initialize DB (runs migrate then exits)
docker compose --profile init up migrate

# 5. Seed categories
docker compose run --rm scheduler bun run db:seed

# 6. Start scheduler in background
docker compose up -d scheduler

# 7. View logs
docker compose logs -f scheduler

# 8. Run one-shot tasks
docker compose run --rm scheduler bun run scrape:once "หูฟังบลูทูธ" 30
docker compose run --rm scheduler bun run generate:once 10
```

### Why Docker

- Identical environment dev → production
- Zero "works on my machine" issues
- Easy rollback (just change image tag)
- Resource limits enforced (1 CPU, 1GB RAM)
- Postgres + bot in single `docker compose up`

## Path B: Bare-metal (current DO Droplet)

Already documented in `docs/digitalocean-setup.md` and `scripts/migrate.sh`.

Key difference: scheduler runs as systemd service instead of docker container:
```bash
sudo cp systemd/affiliate-scheduler.service /etc/systemd/system/
sudo systemctl enable --now affiliate-scheduler
```

## Drizzle migrations

### Generate first migration

```bash
# After any schema.ts change:
bun run db:generate
# → creates src/db/migrations/0000_xxxxx.sql

git add src/db/migrations/
git commit -m "schema: ..."
```

### Apply migrations on production

```bash
# Docker:
docker compose run --rm scheduler bun run db:migrate

# Bare-metal:
bun run db:migrate
```

### Schema iteration in dev

For fast iteration without migration files:
```bash
bun run db:push  # writes schema directly, no migration file
```

This is fine for dev. Production should always use generated migrations.

## CI/CD

### GitHub Actions (.github/workflows/ci.yml)

On push to `main`:
1. **typecheck-lint** — Bun + tsc + biome (warn-only initially)
2. **smoke** — full smoke test against ephemeral Postgres
3. **docker-build** — verify Dockerfile builds (caches in GHA)

### Required secrets in GitHub repo settings

- `ANTHROPIC_API_KEY` — for smoke test (small spend)
- (optional) more for E2E tests

### Manual deploy after merge

CI doesn't auto-deploy yet. To deploy:

```bash
# On production server:
cd /root/research-2
git pull origin main

# Docker path:
docker compose up -d --build scheduler

# Bare-metal path:
sudo systemctl restart affiliate-scheduler
```

## Web deployment (separate from scheduler)

Web is built locally then pushed to Cloudflare Pages:

```bash
bun run build:pages
# → builds Astro + uses wrangler to push to Cloudflare Pages
```

Required env in `.env`:
- `CLOUDFLARE_API_TOKEN` (Pages:Edit, R2:Edit, DNS:Edit)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_PAGES_PROJECT`

### Web → DB connection

Web is **hybrid mode** — most pages prerendered (static), but a few are SSR:
- `/go/[shortId]` — click redirect with logging
- `/api/subscribe` — newsletter signup
- `/confirm/[token]` — email confirm
- `/unsubscribe/[id]` — unsubscribe

These need `DATABASE_URL` available at runtime. Cloudflare Pages provides
these as Pages bindings — set in Cloudflare dashboard:

1. Go to Pages project → Settings → Environment variables
2. Add `DATABASE_URL` (production)
3. Add other env vars: `ANTHROPIC_API_KEY` (only if used in SSR), `RESEND_API_KEY`, `EMAIL_FROM`

## Backups

### Daily backup (already configured)

```bash
# Symlink in /etc/cron.daily
ls -la /etc/cron.daily/affiliate-db-backup

# Manual run
sudo /root/research-2/scripts/backup-postgres.sh
```

### Verify backup integrity (weekly recommendation)

```bash
sudo bash scripts/verify-backup.sh
```

### Off-site backup to DO Spaces

Set in `.env`:
```bash
DO_SPACES_KEY=...
DO_SPACES_SECRET=...
DO_SPACES_REGION=sgp1
DO_SPACES_BUCKET=affiliate-backups
```

`backup-postgres.sh` will auto-upload after dump.

## Monitoring

### Logs

Docker:
```bash
docker compose logs -f scheduler
docker compose logs --tail=100 scheduler
```

Bare-metal:
```bash
sudo journalctl -u affiliate-scheduler -f
```

### Metrics

```bash
bun run stats           # comprehensive system stats
bun run stats --send    # also push to Telegram
bun run smoke           # 10-test smoke suite
bun run winners:report  # weekly winners/losers
```

### Daily Telegram report

Auto-sent at 21:00 every day (cron).

### Weekly winners report

Included in Monday's daily report automatically.

## Disaster recovery

### Scheduler crashes / OOM

Auto-restarts (systemd `Restart=on-failure` or Docker `restart: unless-stopped`).

If repeated crashes:
```bash
# Reduce memory pressure
# Edit docker-compose.yml resources.limits.memory or
# /etc/systemd/system/affiliate-scheduler.service MemoryMax=
```

### Lost database

Restore from latest backup:
```bash
# Docker:
docker compose run --rm scheduler bash -c "
  gunzip -c /var/backups/affiliate/affiliate-LATEST.sql.gz | psql \"\$DATABASE_URL\"
"

# Bare-metal:
gunzip -c /var/backups/affiliate/affiliate-LATEST.sql.gz | psql "$DATABASE_URL"
```

### Lost server

Provision fresh DO Droplet → run `scripts/migrate.sh --token=<gh_pat> --backup=<backup_url>`
→ restore in 15 minutes.

## Cost summary

| Item | Monthly |
|---|---|
| DO Droplet (1 CPU 2GB) | $12 |
| DO Spaces (backups, optional) | $5 |
| Anthropic API (Haiku ~50k pages) | ~$50 |
| Cloudflare Pages | $0 |
| Domain (amortized) | $1 |
| Resend (free tier 3k/mo) | $0 |
| **Phase 2 total** | **~$70/mo** |

Phase 3 adds: ElevenLabs ($22), Flux/Replicate (~$30), Submagic ($20), Webshare proxy ($30) → ~$170/mo

# DigitalOcean Setup Guide

Self-host everything on a single DigitalOcean Droplet — Postgres, scheduler, web build, all in one place.

## Architecture

```
┌──────────── DigitalOcean Droplet ($6–12/mo) ─────────────┐
│                                                          │
│  ├─ Bun runtime                                          │
│  ├─ Postgres 16 (localhost only)                         │
│  ├─ scheduler (systemd, long-running)                    │
│  ├─ Astro build (on demand)                              │
│  └─ ad-hoc CLI scripts                                   │
│                                                          │
└──────────────────────────────────────────────────────────┘
                           │
                           │ pushes static site
                           ▼
                ┌──────────────────────┐
                │   Cloudflare Pages   │  ← public users hit this
                │   (free, unlimited)  │
                └──────────────────────┘
```

**Why this layout**:
- Postgres + bot on localhost = zero network latency for DB queries
- One bill (Droplet only)
- Cloudflare Pages serves static HTML to users — Droplet never gets public traffic
- Backup to DO Spaces ($5/mo) or skip and use git/snapshots

## Step 1 — Create the Droplet

You already have one — skip this if so. Otherwise:

1. Login to https://cloud.digitalocean.com
2. Create → Droplets
3. **Region**: Singapore (`sgp1`) — closest to Thailand
4. **Image**: Ubuntu 24.04 LTS
5. **Size**:
   - Basic Regular Intel: **$6/mo** (1 vCPU, 1 GB RAM, 25 GB SSD) — ok for Phase 1
   - **$12/mo** (1 vCPU, 2 GB RAM, 50 GB SSD) — recommended for Phase 1+2
6. **SSH key**: add yours
7. Hostname: `affiliate-bot`

## Step 2 — Install Bun

```bash
ssh root@<droplet-ip>
apt update && apt install -y curl unzip git
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version  # should be 1.1+
```

## Step 3 — Clone project

If you already have the project at `/root/research-2`, skip. Otherwise:

```bash
cd /root
git clone <your-repo> research-2
cd research-2
bun install
cd src/web && bun install && cd ../..
```

## Step 4 — Install + configure Postgres

Use the included script — it installs Postgres 16, creates the DB, locks it to localhost, tunes for small VPS, and writes `DATABASE_URL` into `.env`:

```bash
sudo bash scripts/setup-postgres.sh
```

Output will look like:

```
▶ Installing Postgres 16...
▶ Creating role 'botuser' and database 'affiliate'...
▶ Restricting to localhost...
▶ Tuning Postgres for small VPS...
▶ Testing connection...
✓ Connection OK
```

Verify:

```bash
bun run check-env
```

## Step 5 — Push schema + seed data

```bash
bun run db:push
bun run db:seed
```

## Step 6 — Test connections

```bash
bun run test-connections
bun run telegram:test
```

## Step 7 — First scrape + generate

```bash
bun run scrape:once "หูฟังบลูทูธ" 30
bun run generate:once 10
```

## Step 8 — Set up systemd for the scheduler

```bash
sudo cp systemd/affiliate-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-scheduler

# Check it's running
sudo systemctl status affiliate-scheduler
sudo journalctl -u affiliate-scheduler -f   # live log
```

## Step 9 — Daily backups

```bash
sudo ln -s /root/research-2/scripts/backup-postgres.sh /etc/cron.daily/affiliate-db-backup

# Test once
sudo /root/research-2/scripts/backup-postgres.sh
# → /var/backups/affiliate/affiliate-YYYYMMDD-HHMMSS.sql.gz
```

### Optional: upload backups to DO Spaces ($5/mo)

1. Create Space at https://cloud.digitalocean.com/spaces
2. Generate API key: API → Spaces Keys → Generate New Key
3. Add to `.env`:

```bash
DO_SPACES_KEY=your_key
DO_SPACES_SECRET=your_secret
DO_SPACES_REGION=sgp1
DO_SPACES_BUCKET=affiliate-backups
```

4. Run backup again — it auto-uploads.

## Step 10 — Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # SSH
# Postgres stays on localhost — no public port
sudo ufw enable
sudo ufw status
```

## Step 11 — Cloudflare Pages deploy (web)

The Astro static site goes to Cloudflare, not the Droplet. From the Droplet:

```bash
bun run build:pages
# → builds Astro + uses wrangler to push to Cloudflare Pages
```

Make sure `.env` has:
```
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_PAGES_PROJECT=<your-project>
```

## Cost summary (DigitalOcean)

| Item | $/month |
|---|---|
| Droplet ($6 starter, $12 better) | $6–12 |
| DO Spaces (optional, for backups) | $5 |
| **Total DO** | **$6–17** |
| External: Anthropic API (~50k pages) | ~$40 |
| External: Cloudflare Pages | $0 |
| Domain (amortized) | $1 |
| **Grand total Phase 1** | **~$50–60** |

## Useful commands

```bash
# Connect to DB
sudo -u postgres psql affiliate

# Or with botuser
psql "$DATABASE_URL"

# DB size
psql "$DATABASE_URL" -c "SELECT pg_size_pretty(pg_database_size('affiliate'));"

# Live log of scheduler
sudo journalctl -u affiliate-scheduler -f

# Restart scheduler
sudo systemctl restart affiliate-scheduler

# Check disk usage
df -h
du -sh /var/lib/postgresql/16/main

# Manual backup
sudo /root/research-2/scripts/backup-postgres.sh
```

## Restoring a backup (worst case)

```bash
# Decompress
gunzip -c /var/backups/affiliate/affiliate-YYYYMMDD-HHMMSS.sql.gz \
  | psql "$DATABASE_URL"
```

## When to upgrade Droplet

- **$6 → $12**: when scrape runs are slow or DB > 5GB
- **$12 → $24** (4 GB RAM): when daily content gen > 200 pages
- **$24 → managed DB + separate Droplet**: when revenue > ฿200k/mo

## Troubleshooting

### `psql: error: connection to server on socket failed`
```bash
sudo systemctl status postgresql
sudo journalctl -u postgresql --no-pager -n 50
```

### `permission denied for schema public`
Postgres 15+ requires explicit grant. The setup script handles this, but if you imported a backup:
```bash
sudo -u postgres psql affiliate -c "GRANT ALL ON SCHEMA public TO botuser;"
```

### Drizzle migrations fail with SSL errors
For self-host on localhost, SSL is off. Make sure `DATABASE_URL` ends with `?sslmode=disable` (the setup script does this).

### Out of disk space
```bash
# What's eating it?
du -sh /var/lib/postgresql/16/main /var/log/postgresql /root/research-2

# Common: postgres logs grew. Rotate:
sudo journalctl --vacuum-time=7d

# Or: too many old backups
find /var/backups/affiliate -name "*.sql.gz" -mtime +14 -delete
```

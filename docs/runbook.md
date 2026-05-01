# Runbook — Day-to-day operations

## First-time setup (1 hour)

### 1. Install runtime
```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL
bun --version  # should be 1.1+
```

### 2. Install deps
```bash
cd /root/research-2
bun install
cd src/web && bun install && cd ../..
```

### 3. Fill .env
Open `.env` and fill the required Phase 1 vars. See `docs/env-setup.md`:
- `DOMAIN_NAME` (after buying)
- `DATABASE_URL` (Neon)
- `ANTHROPIC_API_KEY`
- `SHOPEE_AFFILIATE_ID`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_CHAT_ID`
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- `GITHUB_TOKEN`, `GITHUB_REPO`

Validate:
```bash
bun run check-env
```

### 4. Initialize DB

If using DigitalOcean Droplet (self-host):
```bash
sudo bash scripts/setup-postgres.sh   # installs PG 16 + creates DB + sets DATABASE_URL
bun run db:push   # creates tables
bun run db:seed   # seeds categories
```

If using Neon:
```bash
# Set DATABASE_URL in .env from neon.tech, then:
bun run db:push
bun run db:seed
```

See [digitalocean-setup.md](digitalocean-setup.md) for full DO walkthrough.

### 5. Test connections
```bash
bun run test-connections
bun run telegram:test   # should arrive in your Telegram
```

### 6. First scrape + generation
```bash
bun run scrape:once "หูฟังบลูทูธ" 30
bun run generate:once 10
```

Verify in DB:
```bash
bun run db:studio
# Open the URL → check `products` and `content_pages` tables
```

### 7. First build + deploy
```bash
bun run build:pages
```

If `CLOUDFLARE_API_TOKEN` is set, the static site deploys automatically.

### 8. Start scheduler (production)
```bash
# Foreground (test):
bun run scheduler:start

# Background via systemd (recommended):
# See systemd/affiliate-scheduler.service
```

---

## Daily ops (1–3 hr/week)

### Morning check (5 min)
- Open Telegram → read daily report (sent at 21:00 prev day)
- Check for ⚠️ alerts requiring action
- Glance at revenue trend

### When things break

#### Scraper success rate dropped
```bash
# Look at recent runs
bun run db:studio  # → scraper_runs table
# Or:
psql "$DATABASE_URL" -c "SELECT scraper, target, status, items_failed, error_message
                          FROM scraper_runs
                          ORDER BY started_at DESC LIMIT 20;"
```

Common causes:
- Shopee changed JSON structure → update `src/scraper/shopee/parser.ts`
- IP throttled → add proxy via `WEBSHARE_API_KEY`
- Network blip → ignore if isolated

#### Page generation failures
```bash
psql "$DATABASE_URL" -c "SELECT kind, status, error_message, started_at
                          FROM generation_runs
                          WHERE status='failed'
                          ORDER BY started_at DESC LIMIT 20;"
```

Common causes:
- LLM returned non-JSON → already retried with stricter prompt; if persistent, inspect raw output
- Anthropic credit out → top up at console.anthropic.com
- Rate-limited → automatic backoff handles it

#### Telegram alerts not arriving
```bash
bun run telegram:test
```
Most common: bot was kicked from channel, or token rotated.

#### Cloudflare deploy fails
Manual fallback:
```bash
cd src/web
bun run build
bunx wrangler pages deploy dist --project-name=$CLOUDFLARE_PAGES_PROJECT
```

---

## Weekly ops (15 min)

- Review `compliance_logs` for any blocking violations
- Check `alerts` table for unresolved items
- Inspect top-revenue products in Drizzle Studio — what's working?
- Review `generation_runs` cost — are we within `DAILY_LLM_BUDGET_USD`?

```sql
-- Cost last 7d by kind
SELECT kind,
       SUM(cost_usd) AS total_usd,
       COUNT(*) AS runs
FROM generation_runs
WHERE started_at > now() - interval '7 days'
GROUP BY kind;
```

---

## Scaling up (when revenue > 50k/month)

1. Move VPS to bigger instance (4 vCPU / 8 GB)
2. Enable Layer 7 (campaign optimization): `FEATURE_LAYER_7_CAMPAIGN_OPT=true`
3. Enable Layer 8 (product intelligence): subscribe to FastMoss
4. Add second niche: set `SECONDARY_NICHE`
5. Open Pinterest API access; set `FEATURE_PINTEREST_AUTO_POST=true`

---

## Emergency procedures

### Wipe & restart (last resort)
```bash
# Backup first
pg_dump "$DATABASE_URL" > backup-$(date +%F).sql

# Drop schema
bun run db:studio  # manually drop tables, OR:
# bunx drizzle-kit drop

# Recreate
bun run db:push
bun run db:seed
```

### Pause everything
```bash
# Stop scheduler
systemctl stop affiliate-scheduler

# Or set in .env:
DEBUG_DRY_RUN=true
```

In dry-run mode, the scheduler still runs but:
- Does not POST to Telegram (logs only)
- Does not deploy to Cloudflare
- Still scrapes (read-only) and generates content (writes to DB)

### Revoke compromised credentials
1. Anthropic: console → API keys → revoke + create new
2. Telegram: BotFather `/revoke` (rare; usually rotate is enough)
3. Cloudflare: dashboard → API tokens → roll
4. Shopee Affiliate: contact support — they will issue a new ID

Update `.env`, restart scheduler.

---

## Useful one-liners

```bash
# Top 10 highest-rated products
psql "$DATABASE_URL" -c "SELECT name, rating, sold_count
                          FROM products
                          WHERE rating IS NOT NULL
                          ORDER BY rating DESC, sold_count DESC LIMIT 10;"

# Pages generated today
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM content_pages
                          WHERE created_at::date = CURRENT_DATE;"

# Today's LLM cost
psql "$DATABASE_URL" -c "SELECT ROUND(SUM(cost_usd)::numeric, 2) AS usd
                          FROM generation_runs
                          WHERE started_at::date = CURRENT_DATE;"

# Unresolved alerts
psql "$DATABASE_URL" -c "SELECT severity, code, title, created_at
                          FROM alerts WHERE resolved_at IS NULL
                          ORDER BY created_at DESC;"
```

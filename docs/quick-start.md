# Quick Start — Zero to Running in 10 Minutes

For first-time users: get the system running end-to-end.

## Prerequisites

- DigitalOcean Droplet (Ubuntu 24.04, 1 CPU, 2 GB RAM, $12/mo)
- Domain name registered (any registrar)
- Telegram account
- Email account for Anthropic / GitHub / Cloudflare

## Step 1 — SSH and clone (2 min)

```bash
ssh root@your-droplet-ip
curl -fsSL https://bun.sh/install | bash
exec $SHELL
apt update && apt install -y git
cd /root && git clone https://<TOKEN>@github.com/<your-username>/affiliate-bot.git research-2
cd research-2
bun install
```

## Step 2 — Postgres on same Droplet (3 min)

```bash
sudo bash scripts/setup-postgres.sh
# This installs Postgres 16, creates DB, generates password, writes .env
```

## Step 3 — Fill credentials (3 min)

Edit `.env` — only 5 vars matter for first run:

```bash
nano .env
```

Fill these:
```
DOMAIN_NAME=yourdomain.com
ANTHROPIC_API_KEY=sk-ant-api03-...    # console.anthropic.com → API Keys
TELEGRAM_BOT_TOKEN=...                # @BotFather /newbot
TELEGRAM_OPERATOR_CHAT_ID=...         # Send /start to your bot, then visit:
                                       # api.telegram.org/bot<TOKEN>/getUpdates
SHOPEE_AFFILIATE_ID=...               # affiliate.shopee.co.th dashboard
```

(DATABASE_URL is auto-set by setup-postgres.sh.)

## Step 4 — Run wizard (2 min)

```bash
bun run setup
```

The wizard will:
1. Check env vars
2. Test DB connection
3. Push schema
4. Seed categories
5. Test first scrape (5 products)
6. Test first generation (1 page)
7. Show summary

## Step 5 — See it work

### Option A: With real data (slower)
```bash
bun run scrape:trending          # ~3 min, fetches 60 products
bun run generate:once 20          # ~2 min, $0.02
bun run web:dev                   # http://localhost:4321
```

### Option B: With demo data (instant)
```bash
bun run db:seed-demo              # 20 sample products + pages, no API cost
bun run web:dev                   # see the site immediately
```

## Step 6 — Verify health

```bash
bun run doctor                    # comprehensive diagnostic
bun run smoke                     # 10-test smoke suite
bun run telegram:test             # check ข้อความเด้งใน Telegram
```

## Step 7 — Deploy to production

### Option A: Cloudflare Pages (web)

```bash
# Set Cloudflare creds in .env first:
# CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

bun run build:pages
# Astro builds + wrangler deploys to Cloudflare Pages
```

### Option B: Scheduler as systemd

```bash
sudo cp systemd/affiliate-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-scheduler
sudo journalctl -u affiliate-scheduler -f
```

### Option C: Docker (recommended for new servers)

```bash
docker compose --profile init up migrate
docker compose run --rm scheduler bun run db:seed
docker compose up -d scheduler
docker compose logs -f scheduler
```

## What's running now (after deploy)

20 cron jobs. Daily Telegram report at 21:00.

| Time | Job |
|---|---|
| Every 6h | Scrape trending Shopee |
| 01:00, 13:00 | Scrape trending Lazada |
| 04:00 | Cross-platform match |
| 05:00 | Pull GSC + CF Analytics |
| 06:00 | Cross-platform price-compare pages |
| 07:00 | Generate review pages |
| 07:30 | Generate comparison pages |
| 08:00 (Mon) | Generate best-of lists |
| 09:00 (Mon) | Refresh internal links |
| 09:00 (Fri) | Send weekly email digest |
| 10:00, 16:00, 20:00 | Telegram broadcast deals |
| 11:00, 17:00 | Pinterest pin (if enabled) |
| 14:00 | Twitter thread (if enabled) |
| 21:00 | Daily Telegram report |
| 22:00 | Rebuild sitemap + IndexNow + Google Indexing |
| Every 5min | Health check |
| Every hour | Per-source health |
| Every 3h | Re-score products |
| Sundays 03:00 | Cleanup |

## Daily ops

```bash
bun run stats                     # quick metrics check
bun run stats --send              # also push to Telegram
bun run winners:report --send     # weekly winners/losers
bun run smoke                     # verify all working
sudo /root/research-2/scripts/verify-backup.sh   # weekly
```

## Troubleshooting

```bash
# What's wrong?
bun run doctor

# Recent scraper failures?
psql "$DATABASE_URL" -c "SELECT scraper, target, error_message FROM scraper_runs WHERE status='failed' ORDER BY started_at DESC LIMIT 10;"

# What's the system doing right now?
sudo journalctl -u affiliate-scheduler -f

# How much LLM did I use today?
psql "$DATABASE_URL" -c "SELECT ROUND(SUM(cost_usd)::numeric, 2) AS usd_today FROM generation_runs WHERE started_at::date = current_date;"
```

## Common issues

| Problem | Fix |
|---|---|
| `bun: command not found` | `source ~/.bashrc` or open new terminal |
| `Cannot connect to Postgres` | `sudo systemctl status postgresql && sudo bash scripts/setup-postgres.sh` |
| `Shopee 403 errors` | Wait 5-15 min (rate limit) or enable Webshare proxy |
| `Anthropic 401` | Check ANTHROPIC_API_KEY (must start `sk-ant-api03-`) |
| `No Telegram messages received` | Send `/start` to your bot first; verify CHAT_ID |
| Astro build fails | `cd src/web && rm -rf node_modules && bun install` |

## Next phase

After running 4-8 weeks and Phase 1 stable:
- Read `docs/development-plan.md` for Phase 2-5 spec
- Apply for TikTok Developer + Meta Developer (long approval)
- Start collecting analytics data (Layer 10 already running)
- Consider Phase 3 (social/video) when Phase 1 revenue > ฿20k/mo

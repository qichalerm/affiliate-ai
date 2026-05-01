# Shopee Affiliate AI System

Full-auto Shopee Affiliate aggregator + multi-channel content engine.
Scrapes Shopee → generates SEO-optimized review pages → broadcasts deals to Telegram → tracks compliance.

**Status**: Phase 1 (foundation) — scaffolding complete, ready to plug in credentials.

## What's working in Phase 1

- ✅ Shopee scraper (public JSON API, no auth required for read)
- ✅ Postgres schema with full data model (products, prices, reviews, content_pages, ...)
- ✅ Claude-powered review page generator (Haiku 4.5) with verdict + SEO meta + JSON-LD
- ✅ Static Astro site (homepage, review pages, deals page) deployable to Cloudflare Pages
- ✅ Telegram channel broadcaster (auto-pick top deals, dedupe across 7d)
- ✅ Cron scheduler running 7 jobs (scrape, generate, broadcast, health, daily report, cleanup)
- ✅ Compliance layer (Thai forbidden-words, AI label, affiliate disclosure)
- ✅ Self-healing retry/backoff on every external call

## Project structure

```
.
├── .env / .env.example       # Credentials & feature flags
├── docs/
│   ├── architecture.md       # System design
│   ├── env-setup.md          # How to fill .env
│   └── runbook.md            # Day-to-day ops
├── drizzle.config.ts
├── package.json              # Bun + TypeScript scripts
├── tsconfig.json
├── biome.json                # Lint + format
├── systemd/
│   └── affiliate-scheduler.service
├── src/
│   ├── db/
│   │   └── schema.ts         # Drizzle schema (16 tables)
│   ├── lib/                  # env, db, logger, claude, telegram, retry, format
│   ├── scraper/shopee/       # client, parser, persist, runner
│   ├── content/
│   │   ├── prompts/          # verdict, comparison, seo-meta
│   │   └── generator.ts      # Product → ContentPage
│   ├── compliance/           # forbidden-words, checker
│   ├── publisher/
│   │   └── telegram-channel.ts
│   ├── monitoring/           # health, alerts, daily-report
│   ├── scheduler/            # croner-based job runner
│   ├── scripts/              # check-env, scrape-once, generate-once, build-pages, ...
│   └── web/                  # Astro static site
└── .gitignore
```

## Quick start

### 1. Install Bun
```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Install deps
```bash
bun install
cd src/web && bun install && cd ../..
```

### 3. Fill credentials
Edit `.env` (start with Phase 1 vars in `docs/env-setup.md`).

### 4. Validate
```bash
bun run check-env
bun run test-connections
```

### 5. Initialize DB

Self-host on your DigitalOcean Droplet (recommended):
```bash
sudo bash scripts/setup-postgres.sh   # one-shot installer + creates DB + writes DATABASE_URL
bun run db:push                       # create tables
bun run db:seed                       # populate categories
```

(Or if using Neon: just paste connection string into `.env`, then `bun run db:push`.)

### 6. First run
```bash
bun run scrape:once "หูฟังบลูทูธ" 30      # 30 products
bun run generate:once 10                   # 10 review pages
bun run build:pages                        # builds + deploys to Cloudflare
```

### 7. Start scheduler
```bash
# Foreground:
bun run scheduler:start

# Or via systemd:
sudo cp systemd/affiliate-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-scheduler
```

## Available scripts

| Script | Purpose |
|---|---|
| `bun run check-env` | Validate `.env` is set per current phase |
| `bun run test-connections` | Ping DB, Claude, Telegram, Shopee |
| `bun run db:push` | Apply schema to DB |
| `bun run db:seed` | Insert seed categories |
| `bun run db:studio` | GUI (Drizzle Studio) |
| `bun run scrape:once <kw> [n]` | One-shot scrape |
| `bun run scrape:trending` | Run scheduled trending-scrape job |
| `bun run generate:once [n\|id]` | Generate review pages |
| `bun run build:pages` | Astro build + Cloudflare deploy |
| `bun run compliance:check` | Audit existing pages |
| `bun run telegram:test` | Send test alert to operator |
| `bun run scheduler:start` | Long-running cron |
| `bun run web:dev` | Astro dev server |

## Architecture (TL;DR)

11 layers, decoupled via DB + feature flags:

| # | Layer | Phase |
|---|---|---|
| 1 | Data Collection | ✅ 1 |
| 2 | Content Generation | ✅ 1 |
| 3 | Distribution (web + telegram) | ✅ 1 |
| 4 | Optimization Loop | 4 |
| 5 | Monitoring & Alert | ✅ 1 |
| 6 | Self-Healing | ✅ 1 |
| 7 | Campaign Optimization | 2 |
| 8 | Product Intelligence | 2 |
| 9 | Narrative Engine | 3 |
| 10 | Performance Intelligence | 4 |
| 11 | Compliance | ✅ 1 |

See `docs/architecture.md` for details.

## Cron schedule (default, Asia/Bangkok)

| Cron | Job |
|---|---|
| `0 */6 * * *` | Scrape trending Shopee products |
| `0 7 * * *` | Generate up to 50 missing review pages |
| `0 10,16,20 * * *` | Broadcast deals to Telegram channel |
| `*/5 * * * *` | Health check |
| `0 21 * * *` | Daily report (Telegram) |
| `0 3 * * 0` | Weekly cleanup |

Override via `CRON_*` env vars.

## Cost (Phase 1)

| Item | Monthly |
|---|---|
| DigitalOcean Droplet (1 vCPU 2GB, includes Postgres) | $6–12 |
| DO Spaces (optional backups) | $5 |
| Claude API (Haiku, ~50k pages) | ~$40 |
| Cloudflare Pages | $0 |
| Domain (amortized) | $1 |
| **Total** | **~$50–60** |

Postgres runs on the same Droplet (`localhost`) → zero network latency, one bill.
See [docs/digitalocean-setup.md](docs/digitalocean-setup.md) for setup.

## Expected revenue (base case)

| Month | Revenue/mo |
|---|---|
| 1 | ฿1,500 |
| 3 | ฿50,000 |
| 6 | ฿350,000 |
| 12 | ฿1,200,000 |
| 18 | ฿2,400,000 |

Variance is high — see conversation history for pessimistic/optimistic ranges.

## Compliance notes

- Site footer carries explicit affiliate disclosure
- Telegram broadcasts append `_ลิงก์มี affiliate — ราคาคุณไม่เปลี่ยน_`
- Forbidden Thai marketing words (`รักษา`, `ดีที่สุด 100%`, ...) are auto-softened or block content
- AI-generated text is bounded to ~10% of each page; 90% is real Shopee data
- All affiliate links use `rel="nofollow sponsored"`

## What's intentionally not built yet

- TikTok / Meta / YouTube auto-posters (Phase 3)
- Voice + video generation (Phase 3)
- ML-based content scoring (Phase 4)
- A/B testing framework (Phase 4)
- Dashboard UI (Phase 2)

These are defined in the schema and feature flags so they can be plugged in without refactor.

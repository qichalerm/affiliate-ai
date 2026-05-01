# Shopee Affiliate AI System

Full-auto Shopee Affiliate aggregator + multi-channel content engine.
Scrapes Shopee → generates SEO-optimized review pages → broadcasts deals to Telegram → tracks compliance.

**Status**: Phase 1 **LIVE** — `affiliate-scheduler.service` running 24/7 under systemd on the production Droplet. First scrape went out 2026-05-01.

## What's working in Phase 1

- ✅ Shopee scraper via **Apify `xtracto/shopee-scraper`** — managed actor with built-in anti-bot bypass. (Direct fetch and residential-proxy approaches were both blocked by Shopee's app-layer detection — see [Scraping vendor decision](#scraping-vendor-decision-may-2026) below.)
- ✅ Postgres schema with full data model (products, prices, reviews, content_pages, scraper_runs with `cost_usd_micros`, ...)
- ✅ Claude-powered review page generator (Haiku 4.5) with verdict + SEO meta + JSON-LD
- ✅ Static Astro site (homepage, review pages, deals page) deployed on Cloudflare Pages
- ✅ Telegram channel broadcaster (auto-pick top deals, dedupe across 7d) — currently `DEBUG_DRY_RUN=true`
- ✅ systemd scheduler running 16 jobs (scrape 6×/day, generate, broadcast, health, daily report, cleanup)
- ✅ Compliance layer (Thai forbidden-words, AI label, affiliate disclosure)
- ✅ Per-run cost tracking + daily Apify budget cap (`APIFY_DAILY_BUDGET_USD`)
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
| `0 0,4,8,12,18,21 * * *` | Scrape trending Shopee products (6×/day on flash-sale windows) |
| `30 */2 * * *` | Re-score products (Layer 8) |
| `0 6 * * *` | Generate up to 50 missing review pages |
| `30 7 * * *` | Generate A vs B comparison pages |
| `0 10,16,20 * * *` | Broadcast deals to Telegram channel |
| `0 11,17 * * *` | Pinterest publish (feature-gated) |
| `0 22 * * *` | Sitemap rebuild + submit Google/Bing |
| `0 * * * *` | Per-source health check |
| `*/5 * * * *` | System health check |
| `0 21 * * *` | Daily report (Telegram) |
| `0 3 * * 0` | Weekly cleanup |

Override via `CRON_*` env vars. Lazada-related jobs are filtered out unless `FEATURE_LAZADA_ENABLED=true`.

## Cost (Phase 1, actual)

| Item | Monthly |
|---|---|
| DigitalOcean Droplet (existing, 1 vCPU 2GB, includes Postgres) | $0 marginal |
| **Apify Starter** (Shopee scraper, 6×/day × 90 products = ~540/day) | **$29** |
| Claude API (Haiku, ~3k pages/mo) | ~$10–20 |
| Cloudflare Pages | $0 |
| Domain (amortized) | $1 |
| **Total** | **~$40–50** |

Postgres runs on the same Droplet (`localhost`) → zero network latency, one bill.
See [docs/digitalocean-setup.md](docs/digitalocean-setup.md) for setup.

## Scraping vendor decision (May 2026)

Shopee Thailand has a hard-to-bypass two-layer defence: Cloudflare WAF at the edge **and** an app-layer signed-token check (response code `90309999`) that rejects API calls without a valid `af-ac-enc-dat` header. We empirically tested every credible bypass:

| Approach | Result |
|---|---|
| Direct fetch from DC IP (DigitalOcean) | ❌ 403 at Cloudflare |
| Residential proxy — IPRoyal (TH 3BB IP confirmed) | ❌ Past Cloudflare, blocked at app layer |
| Residential proxy — SOAX | ❌ SOAX itself blocks `shopee.*` at the proxy with `422 Access restricted` |
| Scrapfly ASP + render_js | ❌ HTML returned but search results never populate |
| Playwright Chromium + IPRoyal + warm cookies | ❌ Same `90309999` block |
| **Apify `xtracto/shopee-scraper`** | ✅ Real product data, ~$0.05–0.15 per run of 60–90 items |

Apify is currently the only working path — its actor authors have done the per-target work we'd otherwise have to maintain ourselves. **Plan 2 fallback** would be to build a custom Apify actor (Phase 2 cost-cutting move if traffic justifies it).

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

- Lazada (`FEATURE_LAZADA_ENABLED=false` — no working Apify Lazada actor exists; would need custom build)
- SSR endpoints (`/api/subscribe`, `/go/*`, `/confirm`, `/unsubscribe`) — moved to `src/web/_disabled-ssr/` pending Cloudflare Workers deploy
- Custom domain on Cloudflare Pages — currently using `*.pages.dev`
- TikTok / Meta / YouTube auto-posters (Phase 3)
- Voice + video generation (Phase 3)
- ML-based content scoring (Phase 4)
- A/B testing / true adaptive learning loop (Phase 4)
- Dashboard UI (Phase 2)

These are defined in the schema and feature flags so they can be plugged in without refactor.

## Operating commands

```bash
# Scheduler
systemctl status affiliate-scheduler
journalctl -u affiliate-scheduler -f       # live log feed
systemctl restart affiliate-scheduler      # after .env changes

# Manual scrape (uses Apify if APIFY_TOKEN set)
bun run scrape:once "iphone" 5

# Smoke-test Apify directly
bun run src/scripts/test-apify-shopee.ts
```

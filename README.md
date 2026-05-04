# affiliate-ai

> **Autonomous Shopee affiliate marketing engine** built for the Thai market.
> Scrape → translate → render multilingual SEO site → detect promos → generate
> ads → publish to FB / IG / TikTok → track clicks → learn → repeat.
> One Bun process + one Postgres + Cloudflare Pages — closed loop, no human in
> the daily flow.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3+-orange.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TS-strict-blue.svg)](https://www.typescriptlang.org/)

---

## What this is

A reference implementation of a fully autonomous affiliate-marketing pipeline that:

1. **Scrapes** Shopee Thailand for trending products (4× per day via Apify residential proxy)
2. **Translates** every product into 4 languages (TH source → EN/ZH/JA via Claude Haiku, ~$0.0016/product)
3. **Builds** a static multilingual SEO site (200 products × 4 langs = 850 pages, sub-second rebuild)
4. **Auto-deploys** to Cloudflare Pages within 5 min of each scrape
5. **Detects** price drops, discount jumps, sold-count surges, and new lows every 30 min
6. **Generates** marketing copy (3 angles × 2 channels) for promo products via Claude
7. **Quality-gates** every variant (toxicity / disclosure / forbidden Thai-law terms)
8. **Auto-publishes** to FB Page, IG Business, TikTok during business hours (rate-limited, anti-bot delays)
9. **Tracks clicks** through a Cloudflare Pages Function → Tunnel → DB → 302 to Shopee
10. **Learns nightly**: deactivates underperforming variants (Wilson lower-bound), rebalances scrape budget per niche based on click data

Everything runs unattended on a single 1-2 GB DigitalOcean Droplet + Cloudflare's free tier.

## Why publish this

There's no end-to-end open-source reference for autonomous affiliate marketing in the Thai market. Every commercial tool is either:

- A **browser extension** (closes the API surface, requires a human to leave Chrome open)
- A **SaaS** that locks you into their model + pricing
- A **fragment** (just a scraper, just a content generator, etc.)

This is the whole pipeline, with all the boring infrastructure that makes it actually work autonomously: schedulers, rate limits, cost caps, source-health monitoring, daily reports, niche budget rebalancing, click attribution, multilingual site builder, etc.

## What you can do with it

- **Run as-is** for Shopee Thailand (point at your domain → fill keys → wait)
- **Fork for another marketplace** — replace `src/scraper/shopee/` with Lazada / Amazon / etc.; the rest of the pipeline is marketplace-agnostic
- **Use individual modules**: the bandit (`src/brain/bandit.ts`), the quality gate (`src/quality/`), the multilingual site builder (`src/web/`), the Pages-Function-via-Tunnel pattern (`functions/go/[shortId].ts`) — all work standalone
- **Study** how ~12k lines of TypeScript replace a $5k/mo SaaS stack on a $12/mo droplet

---

## Architecture

### 1. Production infrastructure

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                  USER                                      │
│                (browser on your-domain / FB feed / IG / TikTok)            │
└──────────────────────────┬─────────────────────────────────────────────────┘
                           │ HTTPS
                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       CLOUDFLARE GLOBAL EDGE                               │
│ ┌──────────────────────────────────┐  ┌──────────────────────────────────┐ │
│ │  Pages Project                   │  │  DNS                             │ │
│ │  • 850 static HTML files         │  │  example.com → Pages             │ │
│ │  • 4 langs (TH/EN/ZH/JA)         │  │  www.example.com → Pages         │ │
│ │  • /c/<niche> + /search          │  │  api.example.com → Tunnel CNAME  │ │
│ │  • /p/<slug>.html × 800          │  └──────────────────────────────────┘ │
│ │  • theme.css + sitemap + JSONs   │  ┌──────────────────────────────────┐ │
│ │                                  │  │  Cloudflare Tunnel               │ │
│ │  Pages Function                  │  │  TLS terminate, route to droplet │ │
│ │  /go/[shortId] (proxies clicks)  │◄─│                                  │ │
│ └──────────────────────────────────┘  └──────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────┬┘
                                                                            │
                                                                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│        DROPLET (Ubuntu 24.04 · 1-2GB RAM · single VM)                      │
│                                                                            │
│ ┌──────────────────────────┐  ┌──────────────────────────┐                 │
│ │ systemd: cloudflared     │  │ systemd:                 │                 │
│ │ (outbound tunnel agent)  │  │   affiliate-ai-redirect  │                 │
│ │                          │◄─│ Bun HTTP, 127.0.0.1:3001 │                 │
│ └──────────────────────────┘  └──────────┬───────────────┘                 │
│                                          │                                 │
│ ┌────────────────────────────────────────▼───────────────┐                 │
│ │ systemd: affiliate-ai-scheduler                        │                 │
│ │ Bun + croner — runs 11 cron jobs                       │                 │
│ │                                                        │                 │
│ │  scrapeTrending  promoHunter   autoPublish             │                 │
│ │  learning        engagement    sourceHealth            │                 │
│ │  dailyReport     backfillTr    ...                     │                 │
│ └─────────────────────┬──────────────────────────────────┘                 │
│                       │                                                    │
│ ┌─────────────────────▼──────────────────────────────────┐                 │
│ │ systemd: postgresql.service  (Postgres 16)             │                 │
│ │ localhost:5432 ONLY · 16 tables                        │                 │
│ │  products, product_prices, content_variants,           │                 │
│ │  affiliate_links, clicks, promo_events,                │                 │
│ │  scraper_runs, generation_runs, ...                    │                 │
│ └────────────────────────────────────────────────────────┘                 │
└─────────────────────┬──────────────────────────────────────────────────────┘
                      │ outbound HTTPS only (no inbound except SSH)
                      ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         EXTERNAL SERVICES                                  │
│                                                                            │
│  Apify         ────  Shopee scraper (residential proxy)                    │
│  Anthropic     ────  Claude Haiku/Sonnet (translations + variants)         │
│  Cloudflare    ────  Pages deploy via wrangler                             │
│  Shopee        ────  shp.ee/xxx mint API (commission tracking)             │
│  Meta Graph    ────  FB Page + IG Business posting                         │
│  TikTok        ────  Content Posting API                                   │
│  Replicate     ────  Image gen (Flux) — optional                           │
│  ElevenLabs    ────  Voice clone — optional                                │
│  Resend        ────  Operator email — optional                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### 2. Closed-loop data flow

```
                       ┌─────────────────────────────────┐
                       │  CRON: scrapeTrending           │ 4×/day
                       │  pickKeywordsWeighted (M9)      │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │  Apify Shopee actor             │
                       │  → 4 keywords × 15 products     │
                       └────────────────┬────────────────┘
                                        │
                       ┌────────────────▼────────────────┐
                       │  upsertProduct (M1 persist)     │
                       │  → products + product_prices    │
                       │  → niche tag from keyword       │
                       │  → auto-create web /go link     │
                       └────┬──────────────────────┬─────┘
                            │                      │
        ┌───────────────────┘                      └────────────┐
        ▼                                                       ▼
  ┌──────────────────────┐                       ┌──────────────────────────┐
  │ scheduleSiteRebuild  │ debounce 5 min        │ promoHunter (every 30m)  │
  │ (per scrape success) │                       │ price_drop / discount /  │
  └──────────┬───────────┘                       │ new_low / sold_surge     │
             │                                   └──────────┬───────────────┘
             ▼                                              │
  ┌──────────────────────────┐                              ▼
  │ buildSite()              │             ┌────────────────────────────────┐
  │ 850 HTML in 250ms        │             │ promoTrigger (chained)         │
  │ + theme.css + sitemap    │             │ → generateVariants() force     │
  │ + search-index×4         │             │ → 6 variants (FB+IG × 3 angles)│
  └──────────┬───────────────┘             │ → Quality Gate (6 layers)      │
             ▼                             │ → save content_variants        │
  ┌──────────────────────────┐             └──────────┬─────────────────────┘
  │ deploy → CF Pages        │                        │
  │ (wrangler bunx)          │                        ▼
  └──────────┬───────────────┘          ┌──────────────────────────────────┐
             ▼                          │ autoPublish (every 30m, 8AM-10PM)│
  ┌──────────────────────────┐          │ per channel:                     │
  │ pingAllEngines           │          │  - daily-cap check (5/5/3)       │
  │ IndexNow + Google + Bing │          │  - pick: promo events first      │
  └──────────────────────────┘          │    then top final_score          │
             │                          │  - bandit (M3) picks variant     │
             ▼                          │  - random delay 30–300s          │
  ┌──────────────────────────┐          │  - publishToFB/IG/TikTok         │
  │ your-domain LIVE         │          └──────────┬───────────────────────┘
  │ users browse pages       │                     │
  └──────────┬───────────────┘                     ▼
             │ user clicks "View on Shopee" ┌────────────────────┐
             ▼                              │ social posts LIVE  │
  ┌──────────────────────────────────┐      │ FB / IG / TikTok   │
  │ Pages Function /go/[id]          │      └──────┬─────────────┘
  │ → CF Tunnel api.<your-domain>    │             │ users see post
  │ → droplet redirect-server :3001  │             ▼ click affiliate link
  │ → DB log click (clicks table)    │   ┌─────────────────────────┐
  │ → 302 to shp.ee/xxx              │   │ engagementTracker       │
  │   (or direct Shopee fallback)    │   │ every 2h: pull FB/IG    │
  └──────────┬───────────────────────┘   │ insights → post_metrics │
             ▼                           └────────┬────────────────┘
  ┌──────────────────────────┐                    │
  │ user lands on Shopee     │                    ▼
  │ → COMMISSION TRACKED     │         ┌─────────────────────────┐
  │   (when SHOPEE_API_KEY   │         │ learningOptimizer (M9)  │
  │    is configured)        │         │ nightly 03:00:          │
  └──────────────────────────┘         │  - aggregate CTR        │
                                       │  - Wilson LB cleanup    │
                                       │  - niche budget rebal   │
                                       │  - write insights       │
                                       └────────┬────────────────┘
                                                │
                                                └──► back to scrape (next day)
                                                     weighted by performance
```

### 3. Module map (9 V2 pillars)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                       M0  OPERATIONS  (cron orchestrator)                  │
│   scheduler/  monitoring/source-health  monitoring/daily-report            │
│           ▲                                                                │
│           │ schedules everything                                           │
└───────────┼────────────────────────────────────────────────────────────────┘
            │
   ┌────────┼────────┬────────────┬─────────────┬────────────┬─────────────┐
   ▼        ▼        ▼            ▼             ▼            ▼             ▼
┌──────┐ ┌──────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ M1   │ │ M2   │ │  M3      │ │  M4    │ │   M5     │ │   M6     │ │   M7     │
│Source│ │Signal│ │  Brain   │ │Content │ │Publisher │ │  Promo   │ │Engagemnt │
│      │ │      │ │  Bandit  │ │ Engine │ │ Multi-ch │ │  Hunter  │ │  Track   │
└──┬───┘ └──┬───┘ └────┬─────┘ └───┬────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘
   │        │          │            │            │             │            │
   │ scrape │ score    │ pick       │ generate   │ post        │ detect     │ poll
   │        │          │            │            │             │            │
   │   ┌────▼──────────▼────────────▼────────────▼─────────────▼────────────▼─┐
   └──►│                            DATABASE  (Postgres 16)                   │
       │  products · product_prices · content_variants · affiliate_links      │
       │  clicks · promo_events · scraper_runs · generation_runs · insights   │
       │  shops · categories · published_posts · post_metrics · alerts        │
       └────────┬─────────────────────────────────────────────────────────────┘
                │
                │ reads aggregated stats
                ▼
       ┌─────────────────────────────────────┐
       │  M9  LEARNING OPTIMIZER             │ nightly
       │  + Niche budget rebalancer          │
       │                                     │
       │  • Wilson LB → deactivate losers    │
       │  • Insights row per scope/dimension │
       │  • Updates pickKeywordsWeighted     │
       └────────────┬────────────────────────┘
                    │
                    │ feeds back into M3 (variant pick) + M1 (scrape budget)
                    └────────► closes the loop


  M8  ATTRIBUTION  (orthogonal — runs in user-click path)
  ┌──────────────────────────────────────────┐
  │  CF Pages Function → Tunnel → Bun        │
  │  /go/<shortId> → log click → 302 Shopee  │
  │                                          │
  │  Shopee Open Affiliate API integration   │
  │  → mint shp.ee/xxx links                 │
  │  → commission credited                   │
  └──────────────────────────────────────────┘
                    │
                    │ click counts feed M3 bandit (clicks → α/β)
                    │ click counts feed M9 (niche rebalancer)
                    └────────► reinforces the loop
```

### 4. Module → file mapping

| Module | Status | Files | Lines |
|---|---|---|---|
| **M0** Operations | ✅ live | `src/scheduler/`, `src/monitoring/` | ~1,000 |
| **M1** Source — Shopee | ✅ live | `src/scraper/shopee/` | ~700 |
| **M1** Source — TikTok Shop | 🟡 scaffold | `src/scraper/tiktok-shop/` | ~600 |
| **M2** Signal Analyzer | 🟡 partial | `src/scraper/niches.ts` | ~150 |
| **M3** Brain Bandit | ✅ live | `src/brain/bandit.ts` | ~250 |
| **M4** Content Engine | ✅ text live | `src/content/` | ~1,100 |
| **M5** Multi-channel Publisher | ✅ scaffolded | `src/publisher/` | ~1,200 |
| **M5** Auto-publish dispatcher | ✅ live | `src/publisher/auto-publish.ts` | ~150 |
| **M6** Promo Hunter | ✅ live | `src/brain/promo-hunter.ts` + `promo-trigger.ts` | ~500 |
| **M7** Engagement Tracker | 🟡 ready | `src/engagement/tracker.ts` | ~240 |
| **M8** Click tracking | ✅ live | `src/web/redirect-server.ts`, `functions/go/[shortId].ts` | ~200 |
| **M9** Learning + Niche rebalancer | ✅ live | `src/brain/learning.ts` + `src/scraper/niches.ts` | ~250 |
| **SEO** Sitemap auto-ping | ✅ live | `src/seo/sitemap-ping.ts` | ~120 |
| **Affiliate** Shopee API | ✅ ready | `src/affiliate/shopee-api.ts` | ~180 |
| **Web** Site builder | ✅ live | `src/web/` (templates + builder + deploy) | ~2,000 |
| **DB** schema | ✅ live | `src/db/schema.ts` (16 tables) + `src/db/migrations/` (10 SQL) | ~700 |

**Total: ~12,000 lines TypeScript across 67 files.**

### 5. Cron jobs (11 jobs)

| Job | Schedule | What it does |
|---|---|---|
| `healthCheck` | `*/5 * * * *` | DB ping, log status |
| `scrapeTrending` | `0 8,13,19,22 * * *` BKK | Apify Shopee scrape, weighted niche selection (M9) |
| `scrapeTikTokShop` | `30 9,15,21 * * *` BKK | TikTok Shop scrape (no-op until actor id set) |
| `learningOptimizer` | `0 3 * * *` BKK | Wilson-LB underperformer cleanup, niche click rollup |
| `promoHunter` | `*/30 * * * *` | Detect promos → trigger variant gen |
| `autoPublish` | `10,40 8-22 * * *` BKK | Pick best variant per channel, publish (rate-limited) |
| `engagementTracker` | `0 */2 * * *` | Pull FB/IG insights into post_metrics |
| `sourceHealth` | `15 * * * *` | Detect stale/degraded scrapers, raise alerts |
| `backfillTranslations` | `*/45 * * * *` | Translate products missing EN/ZH/JA |
| `dailyReport` | `0 8 * * *` BKK | Email operator yesterday's stats |
| `shopeeVideoDigest` | `0 10 * * *` BKK | Email upload backlog (Shopee has no posting API) |

### 6. Data flow → table touch matrix

| Table | Written by | Read by |
|---|---|---|
| `products` | M1 scrape | M2 score, M4 content gen, web builder, M9 learning |
| `product_prices` | M1 (every scrape) | M6 promo hunter (sparkline on detail page) |
| `content_variants` | M4 generator | M3 bandit pick, M5 publisher |
| `affiliate_links` | M4 (one per variant) | M8 click handler, web CTA buttons |
| `clicks` | M8 redirect server | M3 bandit (α update), M9 niche rebalancer |
| `promo_events` | M6 hunter | M4 promo trigger, M5 autoPublish (priority pick) |
| `published_posts` | M5 publisher | M7 engagement tracker, M9 learning |
| `post_metrics` | M7 tracker | M9 learning |
| `insights` | M9 nightly | Daily report, future bandit V2 |
| `scraper_runs` | M1 (every run) | M0 source-health, daily report |
| `generation_runs` | claude.ts (every LLM call) | Budget gate, daily report |

### 7. Design decisions (the *why*)

**Why Bun instead of Node?**
Native TypeScript without transpilation step · ~3× faster cold start · Single binary · Native dotenv loading

**Why Postgres self-host instead of managed?**
Localhost = zero network latency · $0 marginal cost vs $15-30/mo managed · Drizzle handles migrations cleanly

**Why static HTML instead of Astro/Next/etc.?**
250ms full rebuild for 850 pages — no framework runtime overhead · One language across server + builder + Cloudflare Function · CDN serves from edge cache infinitely

**Why Cloudflare Pages + Functions + Tunnel?**
All three under one account = no glue code · Pages: free CDN, infinite scale · Functions: 100k req/day free, perfect for /go/<id> · Tunnel: encrypted reverse proxy without opening droplet ports

**Why Apify for Shopee?**
Verified path through Shopee's bot defenses (SOAX, IPRoyal, Scrapfly, Playwright all failed) · Residential TH proxies built-in · ~$0.50/day at our scale

**Why Thompson Sampling for variant selection?**
Self-balances explore/exploit without hyperparameter tuning · Conjugate Beta-Binomial = closed-form posterior · Cold-start: uniform Beta(1,1) prior gives equal chance until evidence accumulates

**Why translate at scrape time, not request time?**
SEO: search engines see real translated content (better ranking than runtime translation) · Latency: zero client-side cost · Cost: translate-once-cache pattern, idempotent on `translations` JSONB

---

## Quick start

```bash
# 1. Clone + install
git clone https://github.com/<your-org>/affiliate-ai.git
cd affiliate-ai
bun install

# 2. Configure
cp .env.example .env
chmod 600 .env
$EDITOR .env   # see docs/SETUP.md for what each var means

# 3. Database
sudo bash scripts/setup-postgres.sh
bun run db:push

# 4. Smoke test
bun run scrape:once "your-keyword" 5
bun run build:site

# 5. Production install (systemd)
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-ai-scheduler affiliate-ai-redirect

# 6. Cloudflare Tunnel for click tracking (one-time)
cloudflared service install <CONNECTOR_TOKEN>

# 7. First deploy
bun run deploy:site
```

Detailed setup walkthrough: [docs/SETUP.md](docs/SETUP.md).

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun 1.3+** | Native TypeScript, fast cold start, single binary |
| Language | **TypeScript** strict | One language across server, scraper, site builder, Cloudflare Functions |
| Database | **Postgres 16** self-host | Localhost = zero latency, $0 marginal cost |
| ORM | **Drizzle** | Type-safe, no codegen, easy migrations |
| LLM | **Anthropic Claude** Haiku 4.5 (bulk) / Sonnet 4.6 (decisions) | Best Thai language, prompt-cache friendly |
| Scraper | **Apify** `xtracto/shopee-scraper` | Verified path through Shopee's bot defenses |
| Web | **Static HTML** generated by Bun | No framework runtime, sub-second rebuilds, infinite CDN scale |
| Edge | **Cloudflare Pages + Functions + Tunnel** | Free CDN + Workers + secure tunnel, all under one CF account |
| Cron | **croner** in-process | One systemd service runs everything (11 jobs) |

---

## Documentation map

| If you want to... | Read |
|---|---|
| See every feature with examples | [docs/FEATURES.md](docs/FEATURES.md) |
| Get it running on your own droplet | [docs/SETUP.md](docs/SETUP.md) |
| Understand env vars + API keys needed | [docs/env-setup.md](docs/env-setup.md) |
| Activate marketing channels (FB/IG/TikTok) after onboarding | [docs/ACTIVATION.md](docs/ACTIVATION.md) |
| Read deep production notes (gotchas, costs, risks) | [docs/HANDOFF.md](docs/HANDOFF.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Report security issues | [SECURITY.md](SECURITY.md) |

---

## License

[MIT](LICENSE) — use it, fork it, ship it. Attribution appreciated but not required.

## Disclaimer

This is engineering reference code. **You are responsible for compliance**:

- Shopee Affiliate Program **Terms of Service**
- Meta Platform **Terms** (Facebook + Instagram posting policies)
- TikTok **Community Guidelines** + Content Posting API ToS
- Thai consumer protection law (อย. + สคบ.) — the Quality Gate's forbidden-words list is a starting point, not a legal guarantee
- Personal data: this system hashes IP + User-Agent before storing clicks, but check your local law (PDPA / GDPR / equivalent)

The maintainers ship code, not legal advice.

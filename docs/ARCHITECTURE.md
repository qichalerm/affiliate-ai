# Architecture

System diagram, module map, data flow, and design decisions.

## 1. Production infrastructure

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

## 2. Closed-loop data flow

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

## 3. Module map (9 V2 pillars)

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

## 4. Module → file mapping

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

## 5. Cron jobs (11 jobs)

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

## 6. Data flow → table touch matrix

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

## 7. Design decisions (the *why*)

### Why Bun instead of Node?
- Native TypeScript without transpilation step
- ~3× faster cold start
- Single binary (no npm install for production runtime)
- Native dotenv loading (`bun --env-file=...`)

### Why Postgres self-host instead of managed?
- Localhost = zero network latency on every query
- Cost: $0 marginal vs ~$15-30/mo for managed
- Drizzle handles migrations cleanly

### Why static HTML instead of Astro/Next/etc.?
- 250ms full rebuild for 850 pages — no framework runtime overhead
- One language (TypeScript) across server + builder + Cloudflare Function
- Cloudflare Pages serves from edge cache infinitely

### Why Cloudflare Pages + Functions + Tunnel?
- All three under one CF account = no glue code
- Pages: free CDN with infinite scale
- Functions: 100k requests/day free, perfect for /go/<id> redirect
- Tunnel: encrypted reverse proxy without opening droplet ports

### Why Apify for Shopee?
- Verified path through Shopee's bot defenses across SOAX, IPRoyal, Scrapfly, Playwright (all failed)
- Residential TH proxies built-in
- ~$0.50/day at our scale (4 scrapes × 4 keywords × 15 products)

### Why Thompson Sampling for variant selection?
- Self-balances explore/exploit without hyperparameter tuning
- Conjugate Beta-Binomial = closed-form posterior, no MCMC
- Cold-start: uniform Beta(1,1) prior gives equal chance to all variants until evidence accumulates

### Why nightly Wilson LB cleanup?
- Statistical guard against premature deactivation of low-sample variants
- Variants with < `MIN_IMPRESSIONS_FOR_DECISION` skipped (preserves explore phase)
- Variants whose Wilson LB is below `globalCtr × UNDERPERFORMER_RATIO` are deactivated (frees bandit budget)

### Why translate at scrape time, not request time?
- SEO: search engines see real translated content (better ranking than runtime translation)
- Latency: zero client-side cost (already-translated HTML served from CDN)
- Cost: translate-once-cache pattern. Re-scrape doesn't retranslate (idempotent on `translations` JSONB)

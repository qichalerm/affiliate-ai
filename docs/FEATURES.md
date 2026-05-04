# Features

Catalog of what each subsystem does, with examples and where to find the code.

---

## 1. Multilingual Static Site

A self-built SSG that produces ~850 pages in 250ms.

- **Output**: `dist/` tree with 4-language routes (`/`, `/en/`, `/zh/`, `/ja/`), category pages, product detail pages, search index JSON, sitemap, robots.txt
- **Theme**: V1 Tailwind theme ported into single 49KB CSS file (no framework runtime)
- **i18n strategy**: every product translated to all 4 langs at scrape time, cached in `products.translations` JSONB. Fall back to Thai source if a language hasn't been translated yet (with small "TH" badge)
- **Search**: client-side JS reads `/search-index-<lang>.json` (~64KB per lang), filters by name/brand substring — no backend roundtrip
- **Auto-deploy**: every successful scrape triggers a debounced 5-min rebuild → `bunx wrangler pages deploy` → CF Pages live

**Files:** `src/web/templates.ts`, `src/web/site-builder.ts`, `src/web/deploy-cloudflare.ts`

```bash
# Manual rebuild + deploy
bun run build:site
bun run deploy:site
```

---

## 2. Apify-based Scraper

Pipeline that handles Shopee's bot defenses + persists into Postgres.

- **Source**: Apify actor `xtracto/shopee-scraper` (residential TH proxy)
- **Schedule**: 4× per day (08:00 / 13:00 / 19:00 / 22:00 BKK) aligned with Shopee flash sale times
- **Keyword selection**: weighted by 14-day click data per niche (M9 niche budget rebalancer)
- **Persistence**: per-product upsert + price history snapshot per scrape + auto-create web `/go` affiliate link
- **Cost**: ~$0.10 per keyword scrape (40 products) → ~$0.50/day at default settings
- **Source health**: stale/low-quality/cost-spike detection raises alerts

**Files:** `src/scraper/shopee/`, `src/monitoring/source-health.ts`

```bash
# One-off scrape (any keyword)
bun run scrape:once "หูฟัง" 40
```

---

## 3. Multilingual Translation

Translate every Thai product into EN/ZH/JA on first scrape, cache in DB.

- **Model**: Claude Haiku 4.5 (`ANTHROPIC_MODEL_FAST`)
- **Cost**: ~$0.0016 per product per 3-language batch
- **Quality**: brand names + technical specs + model numbers preserved exactly across all langs
- **Caching**: `products.translations` JSONB — re-scrape doesn't retranslate (idempotent)
- **Backfill cron**: every 45 min, picks 20 products missing any language, translates, triggers site rebuild on success

**Files:** `src/translation/translator.ts`

```bash
# Backfill all missing translations
bun -e 'import {translateMissingProducts} from "./src/translation/translator.ts"; await translateMissingProducts({limit: 500}); process.exit(0)'
```

---

## 4. Promo Hunter (M6)

Detects 4 types of "rising star" signals every 30 min:

| Signal | Trigger |
|---|---|
| `price_drop` | Current price drops ≥10% below recent floor |
| `discount_jump` | `discount_percent` jumps ≥10pp vs prior snapshot |
| `sold_surge` | sold_count increased ≥2× the 7-day baseline rate in 24h |
| `new_low` | Current price strictly below all prior history points (≥3 samples) |

Each detection writes a `promo_events` row, triggers immediate variant generation for that product (skips the regular queue). 6-hour cooldown per (product, signal-type) prevents spam.

**Files:** `src/brain/promo-hunter.ts`, `src/brain/promo-trigger.ts`

---

## 5. Variant Generation + Quality Gate

Per (product × channel), generates 3 angles using Claude Haiku:
- `deal` — emphasize discount + urgency
- `story` — narrative, lifestyle angle
- `educational` — explain features, comparisons

Each variant runs through 6-layer Quality Gate:
1. **Toxicity** (Claude moderation)
2. **Factual claims** (no medical/financial promises — Thai consumer law)
3. **Brand safety** (no politics/religion/controversy)
4. **Affiliate disclosure** (auto-fix: appends required Thai disclosure if missing)
5. **Image safety** (no copyright text, no faces without permission)
6. **Length + hashtag** conformance per platform

Failed variants are saved with `gate_approved=false` for inspection.

**Files:** `src/content/variant-generator.ts`, `src/quality/gate.ts`

```bash
# Test the Quality Gate
bun run test:gate
```

---

## 6. Multi-Armed Bandit (M3)

Thompson Sampling for variant selection. For each (product × channel):

- **Prior**: Beta(1, 1) — uniform, gives all variants equal chance at cold start
- **Update**: α = 1 + clicks, β = 1 + (impressions − clicks)
- **Selection**: sample from each variant's Beta distribution, pick highest sample
- **Convergence**: in 500-round simulation with ground-truth rates 10%/20%/50%, winner picked 91% of the time after warmup

Self-balances explore/exploit without any hyperparameter tuning. No human in the loop.

**Files:** `src/brain/bandit.ts`

```bash
# Verify bandit converges to known winner
bun run test:bandit
```

---

## 7. Multi-Channel Auto-Publisher (M5)

Cron `autoPublish` runs every 30 min during 8 AM–10 PM BKK. Per channel:

1. Check daily cap (default: FB 5/day, IG 5/day, TikTok 3/day)
2. Find one product with ≥1 gate-approved variant on that channel
3. Skip if posted on that channel in last 24h
4. Rank: products with active promo_events first, then by `final_score`
5. Random delay 30-300s (anti-bot-detection per V2 vision)
6. M3 bandit picks which variant
7. Call `publishToFacebook/Instagram/TikTok` (gates dry-run when token missing)
8. Log to `published_posts` (with `dry_run=true` flag if no token)

**Files:** `src/publisher/auto-publish.ts`, `src/publisher/{facebook,instagram,tiktok}.ts`

---

## 8. Click Tracking (M8)

`/go/<shortId>` URLs on the public site funnel through:

1. User clicks → Cloudflare Pages Function `functions/go/[shortId].ts`
2. Function fetches `https://api.<your-domain>/go/<shortId>` with auth header
3. Cloudflare Tunnel → droplet's redirect-server (Bun, port 3001 localhost-only)
4. Server: DB lookup affiliate_links → log click with hashed IP/UA/country → return 302
5. Function forwards 302 to user's browser → user lands on Shopee (via `shp.ee/xxx` if Shopee API key configured, else direct URL)

Privacy: IP + User-Agent are SHA-256 hashed before storage. Country comes from CF header (no geo-IP lookup).

**Files:** `src/web/redirect-server.ts`, `functions/go/[shortId].ts`

---

## 9. Shopee Open Affiliate API (commission tracking)

Shopee credits affiliate commission only for clicks that land on `shope.ee/xxx` short links. The system mints these by calling Shopee's GraphQL API:

```
POST https://open-api.affiliate.shopee.co.th/graphql
mutation { generateShortLink(input: { originUrl: "...", subIds: [...] }) { shortLink } }
```

- **Auth**: SHA256(app_id + timestamp + payload + secret) signature header (NOT HMAC)
- **subIds**: max 5 per call, populated as `[channel, shortId, campaign, variant]` for full attribution
- **Idempotent**: re-running on existing rows is no-op
- **Backfill**: one-shot script to retro-tag all existing affiliate links once API key arrives

**Files:** `src/affiliate/shopee-api.ts`, `src/scripts/backfill-shopee-shortlinks.ts`

```bash
# After SHOPEE_API_KEY/SECRET arrive
bun run backfill:shopee-shortlinks
```

---

## 10. Engagement Tracker (M7)

Every 2 hours, pulls platform analytics for posts published in the last 7 days:

- **Facebook**: `GET /<post-id>/insights?metric=post_impressions,post_clicks,post_reactions_by_type_total`
- **Instagram**: `GET /<media-id>/insights?metric=impressions,reach,likes,comments,shares,saved`
- **TikTok**: stub (Content Posting API doesn't expose poster analytics — falls back to /go click counts)

Snapshots into `post_metrics` table — time-series so we can chart growth and feed reach back to M9 learning.

When tokens missing, fetcher returns null silently. Schema stays empty until tokens arrive.

**Files:** `src/engagement/tracker.ts`

---

## 11. Learning Optimizer (M9)

Nightly at 03:00 BKK:

1. **Aggregate** yesterday's CTR per (channel, angle, niche)
2. **Wilson lower-bound** test: variants with WLB < threshold deactivated
3. **Niche budget rebalancer**: weight `pickKeywordsWeighted()` by 14-day click data (Laplace-smoothed so cold-start niches keep weight ≥ 1)
4. **Insights row** per (snapshot_date, scope, dimension) — daily report reads from here
5. **Global summary** insight with totals, deactivation count, winners per channel

**Files:** `src/brain/learning.ts`, `src/scraper/niches.ts` (`pickKeywordsWeighted`)

---

## 12. Source Health Monitor (M0)

Every hour at :15, scans `scraper_runs` for 3 silent-degradation patterns:

- **STALE**: no SUCCESS run in last 6h → severity error
- **LOW_QUALITY**: 24h success rate < 50% (with min 3 runs) → severity warn
- **COST_SPIKE**: recent cost-per-item ≥ 3× the 7-day baseline → severity warn

Each detection writes an `alerts` row with code `SOURCE_HEALTH:*` and a 6-hour cooldown. Successful scrape runs auto-resolve open alerts.

**Files:** `src/monitoring/source-health.ts`

---

## 13. Daily Operator Report

Cron at 08:00 BKK aggregates yesterday's pipeline activity into a single email:

- Scrape: runs, success rate, items, cost, new products
- Discovery: promo events by type, top signals
- Generation: variants created/approved, LLM cost
- Publishing: posts attempted by channel (real vs dry-run)
- Engagement: clicks, post_metrics rows captured
- Health: open alerts (severity counts)
- Bandit: top 5 variants by CTR

Three sinks (fail-soft): stdout (always), file `/tmp/affiliate-ai-reports.log` (always), email via Resend (only if `RESEND_API_KEY` + `OPERATOR_EMAIL` set).

**Files:** `src/monitoring/daily-report.ts`

```bash
# Generate yesterday's report on demand
bun -e 'import {runDailyReport} from "./src/monitoring/daily-report.ts"; await runDailyReport(); process.exit(0)'
```

---

## 14. SEO Sitemap Auto-Ping

Every successful auto-deploy pings 4 search engines:

- **IndexNow** (Bing/Yandex/Naver/Seznam): POST URL list to `api.indexnow.org`
- **Google sitemap ping**: `GET /ping?sitemap=...`
- **Bing sitemap ping**: same pattern
- **Verification file**: `<key>.txt` served at site root, key derived deterministically from domain

**Files:** `src/seo/sitemap-ping.ts`

---

## 15. Cost Tracking + Budget Gate

`claude.complete()` writes a `generation_runs` row for every LLM call (provider, model, tokens, cost in USD-micros, duration). The budget gate before every call:

```ts
if (todayLlmSpendUsd() >= DAILY_LLM_BUDGET_USD) throw new LlmBudgetExceededError(...)
```

Daily budget caps (env-tunable):
- `DAILY_LLM_BUDGET_USD=10`
- `DAILY_VIDEO_GEN_BUDGET_USD=10`
- `DAILY_IMAGE_GEN_BUDGET_USD=3`
- `DAILY_VOICE_GEN_BUDGET_USD=2`
- `APIFY_DAILY_BUDGET_USD=2.0`

**Files:** `src/lib/claude.ts`

---

## 16. Multi-language SEO

- Every page has `<link rel="alternate" hreflang="...">` for each of 4 languages + `x-default`
- JSON-LD `Product` schema on detail pages → Google rich results
- Open Graph + Twitter Card meta for social previews
- Static HTML = full text crawlable (vs SPA frameworks)
- Static JSON search index per language for client-side search

**Files:** `src/web/templates.ts` (`htmlHead`, `renderProductPage`, `buildSearchIndex`)

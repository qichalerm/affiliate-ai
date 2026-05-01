# Phase 2 Spec — Scale + Intelligence

> **Goal**: System gets smarter. Knows which products will make money. Auto-claims Shopee missions. Cross-platform price compare.
> **Trigger to build**: Phase 1 stable for ≥4 weeks, ≥10k pages indexed, ≥฿5k/mo revenue.
> **Estimated build effort**: 1-2 chat sessions, ~30-35 new files.
> **New monthly cost when running**: +$60-100 (~$130 total).

---

## Layers introduced

- **Layer 7**: Campaign Optimization (Shopee mission auto-claim, tier optimization)
- **Layer 8**: Product Intelligence (demand × profit × seasonality scoring)
- Pinterest auto-pin (Layer 3c)
- Lazada scraping (extends Layer 1)
- Web Dashboard (operational layer)

---

## Build order (recommended)

1. **Layer 8 scoring** — improves Phase 1 immediately
2. **Pinterest publisher** — easy ROI win
3. **Layer 7 campaigns** — auto-claim bonuses
4. **Lazada scraper** — enables comparison pages
5. **Dashboard** (last; CLI + Telegram covers 80% of dashboard value)

---

## Files to create

### Layer 8 — Product Intelligence

```
src/intelligence/
├── scoring.ts                      # combine demand + profit + seasonality
├── demand-signals.ts               # pull from Shopee best-sellers, search, social
├── profitability.ts                # effective_commission × CVR_estimate × AOV
├── seasonality.ts                  # calendar + weather + event triggers
├── trend-velocity.ts               # detect emerging/rising/peak/declining
└── score-runner.ts                 # cron job: re-score all products every 3h
```

**Schema additions** (`src/db/schema.ts`):
```ts
// Already exists in schema:
//   products.demandScore, products.profitabilityScore,
//   products.seasonalityBoost, products.finalScore
//   trends table

// Add (Phase 2):
export const productScoreHistory = pgTable("product_score_history", {
  id: serial("id").primaryKey(),
  productId: integer("product_id").references(() => products.id),
  demandScore: real("demand_score"),
  profitabilityScore: real("profitability_score"),
  seasonalityBoost: real("seasonality_boost"),
  finalScore: real("final_score"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow(),
});
```

**Algorithm** (`scoring.ts`):
```
final_score = 
    log(sold_30d + 1) × 0.25
  + (rating - 3.5) × 0.2 if rating else 0
  + effective_commission_rate × 0.25
  + seasonal_boost × 0.15
  + trend_velocity_score × 0.15
```

**Wire into Phase 1**:
- Update `jobGeneratePages` in `src/scheduler/jobs.ts` to ORDER BY `final_score DESC` instead of `sold_count DESC`

---

### Pinterest publisher

```
src/publisher/
├── pinterest.ts                    # API client + auto-pin logic
├── pinterest-templates.ts          # 5 visual styles per product
└── short-link.ts                   # Bitly integration for click tracking
```

**Logic**:
- For each product with `final_score > 70` and not yet pinned in last 30d:
  - Generate 3-5 pin variants (different titles + descriptions)
  - Use `primary_image` from Shopee CDN
  - Pin with affiliate short-link (Bitly UTM tagged)
  - Save to `published_posts` table (channel='pinterest')
- Cron: every 4h, max 30 pins/run (Pinterest rate limit)

---

### Layer 7 — Campaign Optimization

```
src/scraper/shopee-dashboard/
├── playwright-login.ts             # headful login with credentials
├── missions-scraper.ts             # scrape /seller-center/affiliate/missions
├── campaigns-scraper.ts            # scrape active campaigns + seasonal boosts
└── tier-tracker.ts                 # track GMV toward next tier
src/intelligence/
├── campaigns.ts                    # auto-enroll + auto-claim logic
└── tier-strategy.ts                # decide when to push for tier upgrade
```

**Critical**:
- Use real Shopee Affiliate login (your credentials in `.env`: SHOPEE_AFFILIATE_USERNAME/PASSWORD)
- **Rate limit**: 1 dashboard request per 5 minutes — Shopee will ban if hammered
- Run in headful mode (less detection): `playwright.chromium.launch({ headless: false })`
- Or use stealth plugin + residential proxy from Webshare

**Schema (already in `campaigns` table)** — just populate it.

**Cron**:
- Every 30 minutes: scrape active campaigns, detect new ones
- On detection: auto-enroll if button present, alert operator if KYC needed
- On reward ready: auto-click claim, log to `campaigns.rewardClaimedAt`

---

### Lazada scraper

```
src/scraper/lazada/
├── client.ts                       # Lazada Open Platform API or web scraper
├── parser.ts                       # → ShopeeProduct equivalent
├── persist.ts                      # upsert into products table (platform='lazada')
└── runner.ts                       # mirror runner.ts from shopee/
src/intelligence/
└── matcher.ts                      # fuzzy-match products across platforms
```

**Match algorithm**:
1. Exact name match → confidence 0.95
2. Brand + model match → 0.85
3. Image hash similarity (perceptual hash) → 0.7
4. Token overlap > 70% → 0.6
5. Below 0.5 → ignore

Save matches to `price_compare` table.

**Cross-platform compare page** at `/เปรียบเทียบ-ราคา/{slug}`:
- Show same product on Shopee vs Lazada vs JD
- Highlight cheapest with strong CTA
- Affiliate link routes to cheapest by default

---

### Dashboard (Next.js)

```
src/dashboard/
├── package.json                    # Next.js 15
├── next.config.mjs
├── app/
│   ├── layout.tsx
│   ├── page.tsx                    # Daily Snapshot
│   ├── revenue/page.tsx            # Revenue Analytics
│   ├── content/page.tsx            # Content Performance
│   ├── trends/page.tsx             # Trends & Opportunities
│   ├── system/page.tsx             # System Health
│   ├── compliance/page.tsx         # Compliance & Risk
│   └── actions/page.tsx            # Action Center
├── components/
│   ├── KpiCard.tsx
│   ├── RevenueChart.tsx
│   ├── ProductTable.tsx
│   └── ...
└── lib/
    ├── auth.ts                     # Clerk integration
    └── queries.ts                  # DB queries
```

**Stack**:
- Next.js 15 + Tailwind + shadcn/ui
- Tremor for charts
- Drizzle (shared schema with main app)
- Clerk auth (free 1 user)
- Deploy: Cloudflare Pages (separate project from web)

**Defer if running short on time** — CLI + Telegram daily report covers 80% of need.

---

## New env vars (added to `.env`)

```bash
# Pinterest
PINTEREST_ACCESS_TOKEN=
PINTEREST_BOARD_IDS=                # comma-separated

# Bitly (link shortener + click tracking)
BITLY_TOKEN=
BITLY_DOMAIN=                       # optional custom short domain

# FastMoss / Kalodata (TikTok product trends)
FASTMOSS_API_KEY=

# Webshare proxy (for scraper rotation)
WEBSHARE_API_KEY=
PROXY_USERNAME=
PROXY_PASSWORD=

# Lazada (optional Phase 2)
LAZADA_AFFILIATE_ID=
LAZADA_API_KEY=
LAZADA_API_SECRET=

# Dashboard auth (Clerk)
CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Feature flag toggles
FEATURE_LAYER_7_CAMPAIGN_OPT=true
FEATURE_LAYER_8_PRODUCT_INTEL=true
FEATURE_PINTEREST_AUTO_POST=true
```

---

## Cron updates

Add to `src/scheduler/index.ts`:

```typescript
{ name: "rescoreProducts",   cron: "0 */3 * * *",   description: "Re-score all products" },
{ name: "scrapeShopeeDashboard", cron: "*/30 * * * *", description: "Check campaigns + missions" },
{ name: "pinterestPublish",  cron: "0 */4 * * *",   description: "Publish 30 pins" },
{ name: "lazadaCompare",     cron: "0 */12 * * *",  description: "Update price comparisons" },
```

---

## New dependencies

```json
{
  "dependencies": {
    "playwright": "^1.49.1",
    "playwright-extra": "^4.3.6",
    "puppeteer-extra-plugin-stealth": "^2.11.2",
    "image-hash": "^5.3.1",
    "fuse.js": "^7.0.0"
  },
  "devDependencies": {
    "@playwright/browser-chromium": "^1.49.1"
  }
}
```

---

## Validation checklist

Before declaring Phase 2 done:
- [ ] All products re-scored every 3h
- [ ] Pinterest pins publishing daily, click-through tracked via Bitly
- [ ] At least one Shopee mission auto-claimed (verify in dashboard)
- [ ] Lazada products in DB with `platform='lazada'`
- [ ] At least 100 `price_compare` rows with confidence > 0.7
- [ ] Comparison page renders at `/เปรียบเทียบ-ราคา/{slug}`
- [ ] Telegram daily report includes new metrics
- [ ] Revenue from Layer 7 (claimed missions) > ฿2,000/mo
- [ ] No Shopee account warning emails

---

## Risks specific to Phase 2

| Risk | Mitigation |
|---|---|
| Shopee bans dashboard scraper | Run from residential IP via Webshare; rate limit aggressively |
| Pinterest rate limit | Cap at 30 pins/run, distribute across 5 boards |
| Lazada API approval delayed | Fallback to web scraper (slower but works) |
| Score model wrong | Track real revenue per score band; recalibrate monthly |
| Dashboard build runs over budget | Defer to Phase 3 — CLI + Telegram is enough |

---

**Estimated build time**: 1-2 chat sessions if focused, 4-6 weeks calendar if part-time
**Skip if**: revenue from Phase 1 < ฿2,000/month after 60 days (means foundation issue, not scale issue)

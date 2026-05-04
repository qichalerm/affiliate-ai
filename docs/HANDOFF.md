# 📒 Handoff — V2 (Sprint 30 production state)

> Read this first before doing anything. Single source of truth for what's
> built, what's running, and how to continue. Audience: future Claude session,
> future you, or a new collaborator.
>
> **Last updated:** 2026-05-04 · **Production URL:** https://price-th.com

---

## 0. One-paragraph summary

A Thai-language Shopee deal-aggregator + autonomous-marketing engine. Scrapes Shopee 4×/day → translates every product to TH/EN/ZH/JA → renders 850-page static site → auto-deploys to Cloudflare Pages within 5 min → detects price drops every 30 min → generates marketing copy → posts to FB/IG/TikTok during business hours → tracks clicks via Pages Function → 302 to Shopee → learns nightly. Everything runs unattended on a single DigitalOcean Droplet + Cloudflare Pages.

History: started as V1 (Telegram-focused, Astro static, full Phase 1-5 plan). User pivoted to V2 in early May 2026 — dropped Telegram, Pinterest, YouTube, Email; locked scope to Shopee + TikTok Shop sources, FB/IG/TikTok/Shopee Video/Web channels; added closed-loop AI brain. V2 was rebuilt from scratch in 30 sprints over 3 days.

---

## 1. Current production state

```
Droplet (DigitalOcean, 162.243.208.103)
├── postgresql.service        Postgres 16, localhost:5432 only
├── affiliate-ai-scheduler    11 cron jobs (croner in-process)
├── affiliate-ai-redirect     Bun HTTP server, 127.0.0.1:3001 (no public port)
└── cloudflared.service       Outbound tunnel: api.price-th.com → :3001

Cloudflare
├── Pages project "shopee-aggregator"
│   ├── 850 static pages (200 products × 4 langs)
│   ├── 1 Function: functions/go/[shortId].ts
│   └── Aliases: price-th.com, www.price-th.com
├── Tunnel "affiliate-ai-redirect" (8a05f6cb-...)
└── DNS: api.price-th.com → CNAME tunnel; price-th.com → Pages

External services in use
├── Apify (Shopee scraper, residential TH proxy)         APIFY_TOKEN
├── Anthropic Claude (Haiku + Sonnet)                    ANTHROPIC_API_KEY
└── (waiting on user) Shopee Open Affiliate API, META Page Token, TikTok
```

DB has 16 tables, 10 migrations. Schema in `src/db/schema.ts`.

---

## 2. The 9 modules (V2 vision)

| # | Module | Status | Files |
|---|---|---|---|
| **M0** | Operations (cron, alerts, daily report, source health) | ✅ live | `src/scheduler/`, `src/monitoring/` |
| **M1** | Source — Shopee scraper | ✅ live | `src/scraper/shopee/` |
| **M1** | Source — TikTok Shop scraper | 🟡 scaffold (no-op until `TIKTOK_SHOP_ACTOR_ID` set) | `src/scraper/tiktok-shop/` |
| **M2** | Signal Analyzer (scoring, niche tagging) | 🟡 partial — niche assigned via keyword backfill, full demand-score deferred | `src/scraper/niches.ts` |
| **M3** | Brain — Thompson Sampling bandit | ✅ live | `src/brain/bandit.ts` |
| **M4** | Content Engine (text + image + voice + video) | ✅ text live, image/voice/video dry-run until keys | `src/content/` |
| **M5** | Multi-channel publisher (FB/IG/TikTok/Shopee Video) | ✅ scaffolded; live posting waits on tokens | `src/publisher/` |
| **M5** | Auto-publish dispatcher (Sprint 30) | ✅ live | `src/publisher/auto-publish.ts` |
| **M6** | Promo Hunter (price drop / discount jump / sold surge / new low) | ✅ live | `src/brain/promo-hunter.ts` |
| **M7** | Engagement Tracker (FB/IG insights polling) | 🟡 ready, no-op until META tokens | `src/engagement/tracker.ts` |
| **M8** | Click tracking (`/go/<shortId>` → tunnel → DB → 302) | ✅ live | `src/web/redirect-server.ts`, `functions/go/[shortId].ts` |
| **M9** | Learning Optimizer + Niche budget rebalancer | ✅ live | `src/brain/learning.ts`, `src/scraper/niches.ts` |
| **SEO** | Sitemap auto-ping (IndexNow + Google + Bing) | ✅ live | `src/seo/sitemap-ping.ts` |
| **Affiliate** | Shopee Open Affiliate API → `shp.ee/xxx` | ✅ ready, no-op until SHOPEE_API_KEY | `src/affiliate/shopee-api.ts` |

---

## 3. Cron jobs (11, all running 24/7)

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

Daily LLM cost at current scale: **< $1/day**. Daily Apify cost: **< $0.50/day**.

---

## 4. Key flows (autonomous, end-to-end)

### Scrape → Site update (5–7 min)
```
Apify scrape → DB upsert (product + price snapshot + niche)
            → scheduleSiteRebuild() (debounce 5 min)
            → buildSite() → 850 pages in ~250ms
            → bunx wrangler pages deploy → CF Pages live
            → IndexNow ping (Bing/Yandex) + Google/Bing legacy ping
```

### Promo detected → Marketing post (~30 min)
```
promoHunter detects price_drop / discount_jump / new_low / sold_surge
         → creates promo_event row
         → promoTrigger (chained) → generateVariants()
              → 6 variants (FB+IG × 3 angles) through Quality Gate
         → autoPublish next tick picks best one per channel
              → bandit selects which approved variant
              → random 30-300s delay (anti-bot)
              → publishToFacebook/Instagram/TikTok
              → published_posts row (dry_run=true if no token)
```

### Click → Commission (sub-second)
```
User clicks /go/<shortId> on price-th.com
         → CF Pages Function functions/go/[shortId].ts
         → fetch https://api.price-th.com/go/<shortId> + X-Internal-Auth
         → CF Tunnel → droplet redirect-server (port 3001 localhost-only)
         → DB lookup (affiliate_links) → log click (clicks table, hashed IP)
         → 302 to shp.ee/xxx (when SHOPEE_API_KEY set) or direct Shopee URL
         → user lands on Shopee → conversion tracked there
```

### Learning loop (nightly + per-tick)
```
Per-tick (M3): every published_post → bandit picks variant by Beta(α,β)
              where α = 1+clicks, β = 1+(impressions−clicks)

Nightly (M9, 03:00 BKK):
  - Aggregate yesterday's CTR per channel × angle
  - Wilson lower-bound test → deactivate variants with WLB < threshold
  - Insert insights row (snapshot per scope/dimension)
  - Niche budget rebalancer: weight pickKeywordsWeighted() by 14d clicks
```

---

## 5. What needs API keys to fully activate

| Priority | Env vars | Activates |
|---|---|---|
| 🔴 P0 | `SHOPEE_API_KEY` + `SHOPEE_API_SECRET` | Commission tracking — converts /go/ clicks into real shp.ee links Shopee credits |
| 🟠 P1 | `META_APP_ID`/`SECRET`, `META_PAGE_ID`, `META_PAGE_ACCESS_TOKEN`, `META_INSTAGRAM_BUSINESS_ID`, `FEATURE_META_AUTO_POST=true` | autoPublish posts to FB Page + IG Business |
| 🟠 P1 | `TIKTOK_CLIENT_KEY`/`SECRET`, `TIKTOK_ACCESS_TOKEN`/`REFRESH_TOKEN`, `TIKTOK_OPEN_ID`, `FEATURE_TIKTOK_AUTO_POST=true` | autoPublish posts videos to TikTok |
| 🟡 P2 | `REPLICATE_API_TOKEN` | Live image gen (Flux) for posts |
| 🟡 P2 | `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` | Thai voice clone for TikTok video narration |
| 🟢 P3 | `RESEND_API_KEY` + `OPERATOR_EMAIL` | Daily report + alerts via email |
| 🟢 P3 | `GOOGLE_OAUTH_CLIENT_ID`/`SECRET`/`REFRESH_TOKEN` | Search Console performance data |
| 🔵 P4 | `TIKTOK_SHOP_ACTOR_ID` | TikTok Shop product scraping |

Detailed activation steps: [ACTIVATION.md](ACTIVATION.md).

---

## 6. Tech stack reference

```
Runtime:          Bun 1.3+
Language:         TypeScript strict
DB:               Postgres 16 self-host on Droplet
ORM:              Drizzle ORM
Validation:       Zod
HTTP:             Bun fetch
LLM:              @anthropic-ai/sdk
Logging:          pino
Cron:             croner (in-process)
Web:              Bun-built static HTML, V1 Tailwind theme ported
                  (theme.css = 49KB compiled Tailwind from V1 Astro build)
Static deploy:    Cloudflare Pages (via bunx wrangler@latest)
Pages Functions:  functions/go/[shortId].ts (1 function only)
Tunnel:           cloudflared (systemd) → api.price-th.com
Lint/format:      Biome
```

### Why this stack

- **Bun + TS** — mainstream, well-supported, fast cold start
- **Postgres + Drizzle** — boring + reliable + type-safe
- **Static HTML** — no framework runtime, sub-second rebuilds, infinite CDN scale
- **Cloudflare** — single account for DNS + Pages + Functions + Tunnel = no glue code
- **Apify** — only realistic path through Shopee bot defenses (verified across SOAX, IPRoyal, Scrapfly, Playwright)

---

## 7. Where to find specific things

| Need | Look in |
|---|---|
| What's running 24/7 | `systemctl status affiliate-ai-*` + `cloudflared` |
| What scheduler does | `src/scheduler/index.ts` (job registry) + `src/scheduler/jobs.ts` (handlers) |
| All env vars | `.env.example` + `src/lib/env.ts` (Zod schema is authoritative) |
| Database schema | `src/db/schema.ts` (16 tables) + `src/db/migrations/` (10 SQL files) |
| Daily report sample | `bun -e 'import {generateDailyReport} from "./src/monitoring/daily-report.ts"; console.log(await generateDailyReport({daysAgo: 1}))'` |
| Site build output | `dist/` (gitignored — generated each build) |
| Site source templates | `src/web/templates.ts` (V1 theme port) |
| Theme CSS | `src/web/static/theme.css` (V1 Astro Tailwind output, 49KB) |
| Cloudflare Page Function | `functions/go/[shortId].ts` |
| Activation when keys land | `docs/ACTIVATION.md` |
| Per-key requirements | `docs/env-setup.md` |

---

## 8. Critical gotchas (the things that bite)

### 8.1 systemd PATH doesn't include `/root/.bun/bin`
**Symptom:** auto-deploy silently fails with `Executable not found in $PATH: "bunx"`.
**Fix:** `deploy-cloudflare.ts` resolves bunx to absolute path before spawn. Don't revert.

### 8.2 systemd `EnvironmentFile=.env` mishandles inline `# comment`
**Symptom:** scheduler crash on boot with Zod validation error on `NODE_ENV=development # comment`.
**Fix:** services use `bun --env-file=...` instead of systemd's parser. Both unit files do this.

### 8.3 `.env` file permission must be 600
World-readable .env was a finding in the systematic audit. Fixed via `chmod 600`. Set this on every fresh droplet.

### 8.4 Shopee API tracking REQUIRES `shope.ee/xxx` short links
**Symptom (until SHOPEE_API_KEY lands):** clicks happen, /go logs them, but Shopee dashboard shows 0 commission.
**Fix:** integrate Shopee Open Affiliate API (Sprint 25 done — code ready, just needs key + run `bun run backfill:shopee-shortlinks`).

### 8.5 Cloudflare Pages Functions can't fetch bare HTTP IPs
**Symptom:** function returns CF error 1003 ("Direct IP access not allowed") when trying to fetch `http://<droplet-ip>:3001`.
**Fix:** must go through HTTPS hostname. We use Cloudflare Tunnel → `api.price-th.com`. The tunnel binding is static — don't break it.

### 8.6 Pages Function only handles GET by default
**Symptom (caught in audit):** link-preview bots (Slack, FB, Discord, X) HEAD a URL → fall through to static handler → unfurl shows wrong content.
**Fix:** functions/go/[shortId].ts exports both `onRequestGet` AND `onRequestHead` (the latter delegates to the former).

### 8.7 Pages Function env vars apply only to NEW deployments
**Symptom:** PATCH `/pages/projects/.../env_vars` returns success but old function still sees old values.
**Fix:** trigger a redeploy after any env change. Or use the `auto-deploy after rebuild` chain — every scrape produces a fresh deploy.

### 8.8 Translation gap can break `/en/`, `/zh/`, `/ja/`
**Symptom (caught in audit):** scrape adds 300 new products → next 45 min before backfill cron, those products appear with Thai-source titles only.
**Fix (Sprint 26):** `localizedProductOrNull()` always returns Thai fallback (with small "TH" badge) instead of skipping the card.

### 8.9 Filenames truncated for ext4 path limits
Thai/Chinese chars are 3 bytes in UTF-8. Long product names blew past 255 bytes filesystem limit.
**Fix:** `safeSlug()` truncates to 40 codepoints + appends product ID for uniqueness. Don't change.

---

## 9. Cost model (current scale)

| Item | Daily | Monthly |
|---|---|---|
| DigitalOcean Droplet (1-2GB) | — | $12 |
| Apify (Shopee scraping at 4×/day, 4 keywords each) | ~$0.50 | ~$15 |
| Anthropic Claude (translations + variants + quality gate) | ~$1 | ~$30 |
| Cloudflare Pages | $0 (free tier covers everything) | $0 |
| Cloudflare Tunnel | $0 | $0 |
| Domain (price-th.com via CF Registrar) | — | ~$0.80 |
| **Total ongoing** | ~$1.50 | ~$58 |

When traffic + paid services activate (image gen / voice / publishing):
- Replicate (image): ~$0.50/day at current scale → **$15/mo**
- ElevenLabs (voice): ~$22/mo at $5/mo subscription tier
- **Realistic full-feature ceiling: ~$120/mo**

---

## 10. How to resume work

### If continuing autonomous operation
- Nothing to do. Services run 24/7. Watch the daily report.
- Verify scraper still works against current Shopee API: `bun run scrape:once "หูฟัง" 5`.
- Common breakage point: Apify actor schema changes → update `src/scraper/shopee/parser.ts`.

### If activating Shopee API
- See [ACTIVATION.md](ACTIVATION.md) §1.

### If activating META (FB+IG)
- See [ACTIVATION.md](ACTIVATION.md) §2.

### If something looks wrong
- Run the systematic audit checklist: `journalctl -u affiliate-ai-scheduler --since "24h ago"` for errors.
- Check `systemctl is-active affiliate-ai-scheduler affiliate-ai-redirect cloudflared postgresql` — all four must be `active`.
- Check `MAX(last_scraped_at)` in DB vs current time — should be < 6 hours stale.
- Check latest Cloudflare deployment timestamp via `gh api` or CF dashboard.

---

## 11. Risks & mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apify Shopee actor breaks | High over 6mo | M0 source-health monitor alerts; we re-target on failure |
| Shopee changes affiliate URL format | Med | Tracked via shp.ee API output; can fall back to direct URL |
| Cloudflare Pages free-tier limit | Low | 100k req/day per Function — current traffic ~50/day |
| Anthropic price hike | Low | Easy swap to OpenAI/Gemini in `src/lib/claude.ts` |
| Postgres data loss | Low if backups | TODO: nightly `pg_dump` to R2 (not yet implemented) |
| Bunx path bug on system update | Low | Hard-coded fallback paths in deploy-cloudflare.ts |
| Translations stale on burst-scrape | Low | TH fallback prevents user-visible breakage; backfill catches up in 45 min |

---

## 12. What "done" looks like

- ✅ **V2 Sprint 30 done** = autonomous closed-loop running 24/7, all 11 modules implemented, site live on price-th.com, 0 critical bugs after audit
- 🔜 **Phase: Activation** = user provides Shopee + META keys → revenue starts flowing
- 🔜 **Phase: Scale** = after 2-4 weeks of real click data → niche rebalancer + bandit converge → optimize scrape budget allocation per niche

---

## 13. Open decisions (not blocking)

- [ ] Backup strategy: nightly `pg_dump` to R2 vs DO Spaces vs nothing (current state: nothing — risk if droplet dies)
- [ ] When to enable image gen (Replicate) — improves CTR but adds cost
- [ ] Whether to publish to TikTok Shop scraper — depends on whether user wants TikTok Shop products on the site
- [ ] V1 → V2 redirect: V1 cached preview URLs still serve old design at random `*.shopee-aggregator.pages.dev` URLs. Acceptable since price-th.com is the canonical.

---

**Conventions:** every commit is one logical change with a short title + paragraph in the body. Commit body explains *why*, not what. Sprint numbers in messages refer to V2 sprints (this document's history).

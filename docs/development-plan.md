# Development Plan — Shopee Affiliate AI System

> **Status as of 2026-04-30**: Phase 1 complete (35% of total structure). Phases 2–5 awaiting build.

---

## TL;DR

- **5 phases** total, **11 architectural layers**
- **Phase 1 (foundation) = ✅ done** — 67 files, ready to run after `.env` is filled
- **Phases 2–5 = pending** — ~110 more files
- **Recommended path**: test Phase 1 in production for 1–2 months, then build Phase 2 with real data signal
- **All-phases-now path**: 5–8 chat sessions to code-complete (~150–180 files total)

---

## 1. The 5 Phases

### Phase 1 — Foundation ✅ COMPLETE

**Goal**: Working pipeline from Shopee → DB → web pages → Telegram broadcast.

**Layers in this phase**: 1, 2, 3 (web), 5, 6, 11

**What was built (67 files)**:
- Database schema (16 tables, Drizzle ORM)
- Shopee scraper using public JSON API (search, browse, detail, reviews, shop)
- Content generator: Claude Haiku verdict + SEO meta + JSON-LD schema
- Astro static site: homepage, /best, /รีวิว/[slug], /about, 404, robots.txt
- Telegram channel broadcaster (auto-pick top deals, 7-day dedupe)
- Cron scheduler with 7 jobs (croner)
- Compliance layer: Thai law forbidden-words, AI label, affiliate disclosure
- Self-healing retry/backoff on every external call
- 8 CLI scripts for ops (check-env, scrape-once, generate-once, build-pages, ...)
- systemd service file
- Full docs (architecture, runbook, env-setup)

**Expected revenue at end of Phase 1**: ฿1,500–5,000/month
**Cost**: ~$50–60/month
**Time investment after build**: 8–12 hr/week × 4 weeks (setup, monitor, fix scraper drift)

---

### Phase 2 — Scale + Intelligence ⏸ PENDING

**Goal**: Cross-platform comparison + smart product scoring + Shopee mission auto-claim + dashboard.

**Layers added**: 7 (Campaign Optimization), 8 (Product Intelligence)

**Files to add (~30–35)**:

| Module | Files | Purpose |
|---|---|---|
| `src/scraper/lazada/` | client, parser, persist, runner | Cross-platform price compare |
| `src/scraper/shopee-dashboard/` | playwright login, missions scraper | Auto-claim Shopee bonuses |
| `src/intelligence/` | scoring.ts, trends.ts, campaigns.ts, matcher.ts | Demand × profit × season ranking |
| `src/publisher/` | pinterest.ts, short-link.ts | Pinterest auto-pin + Bitly tracking |
| `src/dashboard/` | Next.js + 7 views | Web dashboard |
| `src/scripts/` | dashboard-dev, intelligence-test | New CLI |
| `src/web/src/pages/` | /เปรียบเทียบ/[a]-vs-[b].astro, /ดีล/, /หมวด/ | New page types |

**Dashboard views**:
1. Daily Snapshot (revenue + funnel + alerts)
2. Revenue Analytics (by channel, niche, product)
3. Content Performance (per page hit/flop)
4. Trends & Opportunities (real-time radar)
5. System Health
6. Compliance & Risk
7. Action Center (decisions waiting)

**New credentials needed**:
- `PINTEREST_ACCESS_TOKEN` (free)
- `BITLY_TOKEN` (free 1k/mo)
- `FASTMOSS_API_KEY` ($50/mo, optional but doubles Layer 8 effectiveness)
- `WEBSHARE_API_KEY` ($30/mo, optional — needed when Shopee blocks IP)
- `SHOPEE_AFFILIATE_USERNAME/PASSWORD` (for dashboard scraping — your own credentials)

**Expected revenue at end of Phase 2**: ฿10,000–80,000/month
**Cost increase**: +$60–100/month (~$130 total)
**Time investment**: 5–8 hr/week × 4 weeks

**Build estimate**: 1–2 chat sessions

---

### Phase 3 — Social Distribution ⏸ PENDING

**Goal**: Auto-post to TikTok, FB/IG, YouTube. Generate video + voice + images. 1 story → 8 channel formats.

**Layers added**: 9 (Narrative Content Engine)

**Files to add (~35–40)**:

| Module | Files | Purpose |
|---|---|---|
| `src/narrative/` | story-engine.ts, asset-factory.ts, multi-format.ts, drip-scheduler.ts | Story → multi-format pipeline |
| `src/voice/` | elevenlabs.ts, voice-clone.ts | Thai voice generation |
| `src/image/` | flux.ts, midjourney.ts, canva.ts | Image generation |
| `src/video/` | remotion-templates/, ffmpeg.ts, b-roll-fetcher.ts | Programmatic video |
| `src/captions/` | submagic.ts | Auto captions |
| `src/publisher/` | tiktok.ts, meta.ts, youtube.ts, twitter.ts, lemon8.ts (Playwright) | Multi-platform publishing |
| `src/scripts/` | story-once, video-once, post-test | New CLI |
| `src/db/schema.ts` | + tables: stories, story_assets, post_queue | Schema additions |

**New credentials needed**:
- `TIKTOK_ACCESS_TOKEN` (free, **2–4 weeks approval** — apply NOW)
- `META_PAGE_ACCESS_TOKEN` (free, 3–7 days approval)
- `YOUTUBE_API_KEY` + OAuth (free, immediate)
- `ELEVENLABS_API_KEY` ($22/mo)
- `FLUX_API_KEY` or `REPLICATE_API_TOKEN` (~$30/mo)
- `SUBMAGIC_API_KEY` ($20/mo)
- `SUNO_API_KEY` (optional, for BGM)

**Expected revenue at end of Phase 3**: ฿80,000–500,000/month
**Cost increase**: +$90/month (~$220 total)
**Time investment**: depends on posting mode
- Full-auto: 3 hr/week
- Hybrid (record 20 takes/week of yourself for 5–10s intros): 4–5 hr/week

**Build estimate**: 2–3 chat sessions (video pipeline is most complex part of project)

---

### Phase 4 — Performance ML ⏸ PENDING

**Goal**: System self-tunes. Predicts which content will hit before producing. Auto-rebalances budget across channels.

**Layers added**: 10 (Performance Intelligence Loop) + Layer 4 closure

**Files to add (~20–25)**:

| Module | Files | Purpose |
|---|---|---|
| `src/analytics/` | collector.ts, attribution.ts, scoring.ts, anomaly.ts | Per-platform metrics ingestion |
| `src/ml/` | predictor.ts, training.ts, features.ts | Content success prediction |
| `src/ab/` | framework.ts, variants.ts | A/B test orchestration |
| `src/intelligence/` | auto-rebalance.ts, kill-switch.ts | Budget shift + account pause |
| `src/dashboard/` | + views: ML predictions, A/B tests, attribution | Dashboard updates |

**ML approach**:
- LightGBM / XGBoost (no deep learning needed)
- Features: title, hook, format, length, posting_time, niche, product attrs
- Retrain every 2 weeks with last 60 days of data
- Threshold: predicted_score < 60 → skip producing

**New credentials needed**:
- `GOOGLE_SERVICE_ACCOUNT_JSON` (for Search Console — free)
- `SENTRY_DSN` (optional error tracking — free tier)

**Expected revenue at end of Phase 4**: ฿250,000–1,500,000/month
**Cost increase**: +$30/month (~$250 total)
**Time investment**: 1–3 hr/week (system maintains itself)

**Build estimate**: 1–2 chat sessions

---

### Phase 5 — Compound + Scale ⏸ PENDING

**Goal**: Add second/third niche. Backlink campaign. Multilingual. Make business sellable as asset.

**No new layers** — extends Phase 1–4 to multiple verticals.

**Files to add (~10–15)**:

| Module | Files | Purpose |
|---|---|---|
| `src/intelligence/niche-orchestrator.ts` | Run multiple niches in parallel | |
| `src/seo/backlink-tracker.ts` | Track guest post placements | |
| `src/i18n/` | English variants of pages | |
| `src/exports/` | DB → CSV/JSON for due diligence | |
| `src/email/` | newsletter.ts, drip campaigns | |

**New credentials needed**:
- `RESEND_API_KEY` (email — free tier)
- Additional Shopee Affiliate sub-IDs for niche separation

**Expected revenue at end of Phase 5**: ฿500,000–5,000,000/month (depends on # of niches)
**Cost increase**: +$50/month per additional niche (~$300 total)
**Time investment**: 1–2 hr/week

**Build estimate**: 1 chat session

---

## 2. Layer ↔ Phase Mapping

| Layer | Description | Phase | Status |
|---|---|---|---|
| 1 | Data Collection | 1 | ✅ |
| 2 | Content Generation | 1 | ✅ |
| 3 | Distribution (web + Telegram) | 1 | ✅ |
| 3 | Distribution (Pinterest) | 2 | ⏸ |
| 3 | Distribution (TikTok/FB/IG/YT) | 3 | ⏸ |
| 4 | Optimization Loop | 4 | ⏸ |
| 5 | Monitoring & Alert | 1 | ✅ |
| 6 | Self-Healing | 1 | ✅ |
| 7 | Campaign Optimization (Shopee missions) | 2 | ⏸ |
| 8 | Product Intelligence (demand × profit × season) | 2 | ⏸ |
| 9 | Narrative Content Engine | 3 | ⏸ |
| 10 | Performance Intelligence + ML | 4 | ⏸ |
| 11 | Compliance & Policy | 1 | ✅ |

---

## 3. Timeline Options

### Option A: Phase-by-phase (RECOMMENDED) ⭐

```
Now             Phase 1 = ready to run
Week 1          Fill .env Phase 1, run first scrape, deploy
Week 2-4        Monitor Phase 1 in production, collect data
Month 2         Build Phase 2 (in chat session)
Month 2-3       Run Phase 2, monitor
Month 3         Build Phase 3 (TikTok approval should be ready)
Month 3-4       Run Phase 3
Month 5         Build Phase 4
Month 6+        Build Phase 5 + scale
```

**Pros**: Test before adding complexity. Real data informs Phase 2 scoring. SEO has time to compound.
**Cons**: Total feature set takes 6 months.

### Option B: Build all phases now

```
Session 2       Build Phase 2 (~30 files)
Session 3-4     Build Phase 3 (~35-40 files, video complex)
Session 5       Build Phase 4 (~20-25 files)
Session 6       Build Phase 5 (~12 files)
```

**Pros**: Code-complete faster. No context loss between sessions.
**Cons**: Massive code review surface. Cannot tune Phase 4 ML without Phase 1-3 data. TikTok dependent on approval.

### Option C: Critical Phase 2 only

Build just the high-ROI subset of Phase 2:
- Pinterest publisher (works immediately)
- Layer 8 scoring (improves Phase 1 quality)
- Layer 7 campaign tracker (claims Shopee bonuses automatically)

Skip: Lazada scraper, dashboard (defer).

**Pros**: Phase 1 + 30% of Phase 2 = ROI boost without scope explosion.
**Cons**: No dashboard, no cross-platform compare yet.

---

## 4. Cost Trajectory

| Phase | Monthly cost | Cumulative startup cost | Realistic revenue range |
|---|---|---|---|
| 0 (setup) | $0 | $20 (Anthropic credit) | ฿0 |
| 1 | ~$60 | $40 (domain + first month) | ฿1,500–5,000 |
| 2 | ~$130 | +$90 service signups | ฿10k–80k |
| 3 | ~$220 | +$72 first month services | ฿80k–500k |
| 4 | ~$250 | +$30 | ฿250k–1.5M |
| 5 | ~$300+ | +$50 per niche | ฿500k–5M+ |

**Break-even point**: ~Month 2 (revenue covers cost)
**Variance**: HIGH — power-law distribution, not bell curve.

---

## 5. Credential Timeline

### Apply IMMEDIATELY (long approval times)

| Service | Approval time | When you'll need it |
|---|---|---|
| **TikTok Developer** | 2–4 weeks | Phase 3 |
| **Meta Developer** (FB+IG) | 3–7 days | Phase 3 |
| **Shopee Affiliate** | 1–3 days | Phase 1 |

### Sign up when starting Phase 1 (~now)

| Service | Cost | Time |
|---|---|---|
| Anthropic Console | Pay $20 to start | 5 min |
| DigitalOcean Droplet ($6–12/mo, includes self-host Postgres) | $6–12/mo | 10 min |
| Cloudflare | Free | 10 min |
| Telegram Bot (`@BotFather`) | Free | 5 min |
| GitHub | Free | (existing) |
| Domain (Cloudflare Registrar) | $10/yr | 10 min |

> Database runs on the same Droplet (no separate Neon signup). See [digitalocean-setup.md](digitalocean-setup.md).

### Sign up when starting Phase 2

- Pinterest Developer (free, 1 day)
- Bitly (free)
- FastMoss (paid, immediate) — optional but recommended
- Webshare proxy (paid, immediate) — optional

### Sign up when starting Phase 3

- ElevenLabs ($22/mo)
- Replicate or Flux Pro (~$30/mo)
- Submagic ($20/mo)
- YouTube Data API (free, configure OAuth)

---

## 6. Decision Points (look ahead)

### Before Phase 2: should we add Lazada scraping?
- **Yes if**: cross-platform price comparison is differentiator
- **No if**: Shopee data alone covers user intent (most people only shop one platform)

### Before Phase 3: full-auto vs hybrid?
- **Full-auto** (no human face): ROI lower, easier to scale farms
- **Hybrid** (5–10s human intro/wk): ROI 5–10x but requires you on camera weekly
- Decide based on willingness to record + niche fit

### Before Phase 4: build dashboard or stay CLI?
- **Dashboard**: nicer for daily check, slower to build
- **CLI + Telegram daily report**: 80% of dashboard value at 20% of code

### Before Phase 5: scale niche or scale channels?
- **Scale niche**: more product categories
- **Scale channels**: more languages/regions
- Pick whichever has stronger demand signal in Phase 4 data

---

## 7. Risk Register

| Risk | Mitigation built-in |
|---|---|
| Shopee changes JSON API | Fallback to Playwright in Phase 2 |
| Anthropic API quota out | Graceful skip, alert operator |
| Cloudflare deploy fail | Last-good build remains live |
| TikTok/Meta refuses dev account | Phase 3 features feature-flagged off |
| AI content reach declines further | Phase 4 ML detects + auto-rebalances |
| Google algorithm penalty | 90% real data + price history = defensible |
| Account ban (any platform) | Multi-channel diversification (max 40% concentration) |
| Operator disappears for weeks | Self-healing + dry-run + alerts buffer |

---

## 8. What to do tomorrow when you return

### Path A: test Phase 1 (recommended)

```bash
# 1. Fill required vars in .env (see docs/env-setup.md):
#    DOMAIN_NAME, DATABASE_URL, ANTHROPIC_API_KEY,
#    SHOPEE_AFFILIATE_ID, TELEGRAM_BOT_TOKEN, TELEGRAM_OPERATOR_CHAT_ID,
#    CLOUDFLARE_API_TOKEN, GITHUB_TOKEN

cd /root/research-2
bun install
cd src/web && bun install && cd ../..

bun run check-env
bun run db:push
bun run db:seed
bun run test-connections
bun run telegram:test

bun run scrape:once "หูฟังบลูทูธ" 30
bun run generate:once 10
bun run build:pages
```

If anything breaks → tell Claude tomorrow, we fix together.

### Path B: keep building (Phase 2)

Just say: "เริ่ม Phase 2" and Claude resumes with Lazada scraper + Layer 8 scoring + Pinterest + dashboard.

### Path C: ask anything

Architecture questions, deployment help, business strategy — pick up wherever feels useful.

---

## 9. Files to read tomorrow to re-orient

1. **[README.md](../README.md)** — what was built, quick start
2. **[docs/architecture.md](architecture.md)** — system design
3. **[docs/runbook.md](runbook.md)** — daily ops
4. **[docs/env-setup.md](env-setup.md)** — fill `.env`
5. **This file** — where we are in the bigger plan

---

## 10. Status snapshot

```
Phase 1: ████████████████████ 100% ✅
Phase 2: ░░░░░░░░░░░░░░░░░░░░   0%
Phase 3: ░░░░░░░░░░░░░░░░░░░░   0%
Phase 4: ░░░░░░░░░░░░░░░░░░░░   0%
Phase 5: ░░░░░░░░░░░░░░░░░░░░   0%

Overall: ███████░░░░░░░░░░░░░  35%
```

**Last updated**: 2026-04-30 (end of session 1)
**Next session**: tomorrow — choose Path A / B / C above

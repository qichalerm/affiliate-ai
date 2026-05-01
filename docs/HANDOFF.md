# 📒 Project Handoff Document

> Read this first before doing anything. This is the single source of truth for what was decided, what was built, and how to continue.
>
> **Audience**: future Claude session, future you, or a new collaborator.

---

## 0. One-paragraph summary

**Build a Thai-language Shopee Affiliate aggregator + multi-channel content engine.**
Niche: IT/Gadget. Scrape Shopee → Postgres → Claude generates SEO review pages → Astro static site on Cloudflare Pages → Telegram broadcasts deals. All on one DigitalOcean Droplet. Layers 2/3/4/5 add: cross-platform compare, social posters (TikTok/FB/IG/YT), narrative video engine, ML-driven self-tuning. Expected revenue: ~฿1.5M Year 1 / ~฿7M Year 2 (probability-weighted, Phase 3+ path).

---

## 1. Origin & Context

The project began as an exploration of "AI bot that makes money", evaluating:

1. ❌ **Polymarket weather betting** — explored, rejected. Markets in 2026 are too efficient; ROI/hour low; regulatory grey for Thailand.
2. ✅ **Shopee Affiliate** — chosen. Thai market is mature, infrastructure is mature, can use AI heavily, and has clear scale path (Priceza is the existence proof).

User profile inferred from conversation:
- Thai-based
- Has a DigitalOcean Droplet already
- VSCode + Claude Code workflow
- Wants 95%+ automation but understands "fully hands-off forever" is unrealistic
- Open to hybrid mode (record themselves on camera 5-10s/week) for higher ROI
- Long-term thinking — wants asset that compounds, not get-rich-quick

---

## 2. Key Decisions (and why)

| Decision | Choice | Reason |
|---|---|---|
| Niche | **IT/Gadget** | Highest AOV (฿1,200+), clean specs, Priceza is weak on TikTok Shop deals |
| Posting mode | **Hybrid** (5-10s human face/wk) | 5-10x ROI vs full-AI in 2026, sustainable per TikTok TOS |
| Runtime | **Bun** | Native TS, fastest startup, single-binary |
| Language | **TypeScript strict** | Single language across server + scraper + web |
| DB | **Postgres 16 self-host on DO Droplet** | Localhost = zero latency, one bill, no vendor lock |
| Web | **Astro static** + Cloudflare Pages | Best SSG SEO, free CDN, fastest in TH |
| AI | **Claude Haiku 4.5 fast / Sonnet 4.6 smart** | Best Thai language, cheapest pre-cache |
| Cron | **croner (in-process)** | Simpler than k8s; one VPS = whole system |
| Logging | **pino** | Fastest JSON logger |
| Validation | **Zod** | Env, prompt outputs, API responses |
| Compliance | **Layer 11** (forbidden-words + AI label + affiliate disclosure) | Thai law (อย./สคบ.) + platform TOS |
| Budget | ~$60/mo Phase 1 → ~$300/mo Phase 5 | Ramps with revenue, never pre-paid |

### Decisions NOT to make yet (deferred until data)

- Lazada scraping priority vs new niche — wait for Phase 1 traffic data
- Dashboard build (CLI + Telegram is 80% of dashboard value at 20% effort)
- Full-auto vs hybrid for TikTok — depends on user willingness to record
- Multi-niche timing — Phase 5 pacing decided by data

---

## 3. The 11-Layer Architecture

| Layer | Purpose | Phase | Built? |
|---|---|---|---|
| 1 | Data Collection (Shopee public JSON) | 1 | ✅ |
| 2 | Content Generation (verdict + SEO meta + JSON-LD) | 1 | ✅ |
| 3a | Distribution: Web (Astro) | 1 | ✅ |
| 3b | Distribution: Telegram channel | 1 | ✅ |
| 3c | Distribution: Pinterest | 2 | ⏸ |
| 3d | Distribution: TikTok/FB/IG/YT | 3 | ⏸ |
| 4 | Optimization Loop | 4 | ⏸ |
| 5 | Monitoring & Alert | 1 | ✅ |
| 6 | Self-Healing (retry/backoff) | 1 | ✅ |
| 7 | Campaign Optimization (Shopee mission auto-claim) | 2 | ⏸ |
| 8 | Product Intelligence (demand × profit × season) | 2 | ⏸ |
| 9 | Narrative Content Engine (1 story → 8 formats) | 3 | ⏸ |
| 10 | Performance Intelligence (analytics + ML) | 4 | ⏸ |
| 11 | Compliance & Policy (Thai + TOS) | 1 | ✅ |

---

## 4. The 5 Phases

### ✅ Phase 1 — Foundation (DONE — 67 files)

**What exists**: scraper, generator, web, Telegram broadcaster, scheduler, compliance, monitoring, all CLI scripts, Astro static site, systemd service, full docs.

**See**: [development-plan.md](development-plan.md) Phase 1 section, [architecture.md](architecture.md), file list in [README.md](../README.md).

**Expected revenue at end of Phase 1**: ฿1.5k–฿5k/month
**Cost**: ~$60/mo

### ⏸ Phase 2 — Scale + Intelligence (~30 files to add)

Adds Lazada scraping, Layer 7 (Shopee mission auto-claim), Layer 8 (smart product scoring), Pinterest publisher, dashboard.

**See**: [phase-2-spec.md](phase-2-spec.md) for detailed file-by-file build plan.

**Expected at end**: ฿10k–฿80k/month

### ⏸ Phase 3 — Social Distribution (~35 files to add)

Adds Layer 9 (narrative engine: voice + image + video pipeline), TikTok/Meta/YouTube publishers.

**See**: [phase-3-spec.md](phase-3-spec.md).

**Expected at end**: ฿80k–฿500k/month

### ⏸ Phase 4 — Performance ML (~22 files to add)

Adds Layer 10 (analytics collector, attribution, ML predictor, A/B framework, auto-rebalance).

**See**: [phase-4-spec.md](phase-4-spec.md).

**Expected at end**: ฿250k–฿1.5M/month

### ⏸ Phase 5 — Compound + Scale (~12 files to add)

Multi-niche orchestration, backlinks, multilingual, exports.

**See**: [phase-5-spec.md](phase-5-spec.md).

**Expected at end**: ฿500k–฿5M/month

---

## 5. Tech stack reference

```
Runtime:          Bun 1.1+
Language:         TypeScript strict
DB:               Postgres 16 (self-host on Droplet)
ORM:              Drizzle ORM
Validation:       Zod
HTTP:             Bun fetch (+ Playwright for fallback in Phase 2)
LLM:              @anthropic-ai/sdk (Haiku 4.5 + Sonnet 4.6)
Logging:          pino + pino-pretty
Cron:             croner
Telegram:         telegraf
Web:              Astro 5 + Tailwind 3
Static deploy:    Cloudflare Pages (via wrangler)
Object storage:   R2 (or DO Spaces for backups)
Lint/format:      Biome
```

### Why this stack survives 2-3 years
- Bun + TS = mainstream, well-supported
- Postgres = boring, reliable, decade+ runway
- Drizzle = type-safe, zero magic, easy to swap
- Astro = static, no runtime dependency, can host anywhere
- All open-source — no vendor lock-in

---

## 6. Where to find specific things

| Need | Look in |
|---|---|
| What's built | `src/` + `README.md` |
| How to run on fresh server | `docs/runbook.md` + `scripts/migrate.sh` |
| DigitalOcean specifics | `docs/digitalocean-setup.md` |
| Fill .env | `docs/env-setup.md` |
| Architecture | `docs/architecture.md` |
| Revenue projection | `docs/reports/revenue-projection.html` (open in browser) |
| Master plan | `docs/development-plan.md` |
| Detailed Phase 2 plan | `docs/phase-2-spec.md` |
| Detailed Phase 3 plan | `docs/phase-3-spec.md` |
| Detailed Phase 4 plan | `docs/phase-4-spec.md` |
| Detailed Phase 5 plan | `docs/phase-5-spec.md` |
| Compliance rules | `src/compliance/forbidden-words.ts` |
| All env vars | `.env.example` |
| Database schema | `src/db/schema.ts` |

---

## 7. Critical gotchas (the things that bite)

### 7.1 Shopee API endpoints are unofficial
The scraper hits `shopee.co.th/api/v4/...` — these are public web JSON endpoints, not officially documented. **They can change without notice.** When that happens:
- Symptom: scraper success rate drops
- Fix: update parsers in `src/scraper/shopee/parser.ts`
- Long-term: add Playwright fallback in Phase 2 (`src/scraper/shopee/playwright-runner.ts`)

### 7.2 Postgres 15+ requires explicit schema grant
After creating user, must run `GRANT ALL ON SCHEMA public TO botuser;` — `setup-postgres.sh` handles this.

### 7.3 Affiliate dashboard rate limiting (Phase 2)
Shopee dashboard scrape uses Playwright + your real login. Don't hammer it — max 1 request per 5 minutes. If banned, wait 24-48h before retrying.

### 7.4 TikTok AI label requirement (2026)
TikTok demotes AI-only content. **Required**: enable "AI Content" toggle in `src/publisher/tiktok.ts`. Hidden cost: full-AI faceless videos get throttled to ~200 views regardless of quality. Hybrid mode (5-10s human face) avoids this.

### 7.5 Thai marketing law
- ห้ามอ้างคำว่า "รักษา", "หาย", "ดีที่สุด 100%"
- รายได้ affiliate > ฿60k/ปี ต้องยื่นภาษี
- ถ้า revenue > ฿1.8M/ปี ต้องจดทะเบียน VAT
- หากโฆษณาเครื่องสำอาง/อาหารเสริม ต้องมีเลข อย.

`src/compliance/forbidden-words.ts` auto-softens most issues.

### 7.6 Cloudflare Pages + Thai filenames
Astro page route `/รีวิว/[slug]` works locally but some CI may have issues with non-ASCII paths. Tested OK on Cloudflare Pages — but if you change CI, verify URL encoding.

---

## 8. Credentials — what's needed when

### Need IMMEDIATELY (Phase 1 production)
- `DOMAIN_NAME` — Cloudflare Registrar ($10/yr)
- `DATABASE_URL` — auto-generated by `setup-postgres.sh`
- `ANTHROPIC_API_KEY` — console.anthropic.com (start with $20)
- `SHOPEE_AFFILIATE_ID` — affiliate.shopee.co.th (1-3 days approval)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_OPERATOR_CHAT_ID` — @BotFather (free)
- `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` — Cloudflare dashboard
- `GITHUB_TOKEN` + `GITHUB_REPO` — for git push automation

### Apply NOW even if not needed yet (long approval)
- **TikTok Developer**: 2-4 weeks approval — needed Phase 3
- **Meta Developer (FB+IG)**: 3-7 days — needed Phase 3

### Add for Phase 2
- `PINTEREST_ACCESS_TOKEN` (free)
- `BITLY_TOKEN` (free 1k/mo)
- `FASTMOSS_API_KEY` ($50/mo, optional but improves Layer 8)
- `WEBSHARE_API_KEY` ($30/mo, optional, for proxy when Shopee blocks)
- `SHOPEE_AFFILIATE_USERNAME/PASSWORD` (Layer 7 dashboard scrape — your own login)

### Add for Phase 3
- `TIKTOK_ACCESS_TOKEN` (after dev approval)
- `META_PAGE_ACCESS_TOKEN` (after dev approval)
- `YOUTUBE_API_KEY` + OAuth (instant)
- `ELEVENLABS_API_KEY` ($22/mo)
- `FLUX_API_KEY` or `REPLICATE_API_TOKEN` (~$30/mo)
- `SUBMAGIC_API_KEY` ($20/mo)

### Add for Phase 4
- `GOOGLE_SERVICE_ACCOUNT_JSON` (Search Console — free)

---

## 9. Migration to a new server (TL;DR)

```bash
# 1. New Droplet (Ubuntu 24.04, Singapore, 1-2 GB RAM)
ssh root@<new-ip>

# 2. One-shot setup
curl -fsSL https://bun.sh/install | bash
exec $SHELL
apt update && apt install -y git
cd /root && git clone https://<TOKEN>@github.com/qichalerm/affiliate-bot.git research-2
cd research-2

# 3. Install + configure
bun install
cd src/web && bun install && cd ../..

# 4. Copy .env from old server (KEY: NOT in git for security)
scp old-server:/root/research-2/.env .env

# 5. Or recreate Postgres locally
sudo bash scripts/setup-postgres.sh

# 6. Restore DB from backup (if migrating with data)
gunzip -c affiliate-backup.sql.gz | psql "$DATABASE_URL"

# 7. Verify
bun run check-env
bun run test-connections

# 8. Start scheduler
sudo cp systemd/affiliate-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-scheduler
```

See [scripts/migrate.sh](../scripts/migrate.sh) for the automated version.

---

## 10. How to resume building (next session)

### If continuing Phase 1
- Read `README.md`, run through `docs/runbook.md` setup
- First: ensure scraper still works against current Shopee API (`bun run scrape:once "หูฟัง" 5`)
- Common fix: update selectors in `src/scraper/shopee/parser.ts`

### If starting Phase 2
- Read `docs/phase-2-spec.md`
- Build order: Layer 8 scoring (improves Phase 1 quality) → Pinterest publisher → Layer 7 campaigns → Lazada scraper → dashboard
- Don't skip ahead — Layer 8 needs the scoring data Phase 1 collects

### If starting Phase 3
- Verify TikTok Developer + Meta Developer accounts approved
- Read `docs/phase-3-spec.md`
- Build order: voice (ElevenLabs) → image gen → video assembler (Remotion) → narrative engine → individual platform publishers

### If starting Phase 4
- Need 60+ days of analytics data first — don't start ML without data
- Read `docs/phase-4-spec.md`
- Build order: analytics collectors → attribution → scoring → predictor → A/B framework

### If starting Phase 5
- Only after Phase 4 ML stable + revenue > ฿100k/mo
- Read `docs/phase-5-spec.md`

---

## 11. Conversation summary (for future Claude sessions)

The full conversation is preserved as themes:

1. **Discovery**: explored Polymarket weather (rejected), settled on Shopee affiliate
2. **Strategy**: discussed full-auto vs hybrid posting, decided hybrid
3. **Architecture**: designed 11 layers, mapped to 5 phases
4. **Build**: Phase 1 implementation (this session built 67 files)
5. **Infrastructure**: chose DigitalOcean self-host (vs Neon)
6. **Operations**: revenue projection, cost model, decision matrix

Key user statements (for behavioral continuity):
- "ระบบต้องทำกำไรได้ยิ่งเยอะยิ่งดี" — optimize for revenue, not minimum viable
- "คุณตัดสินใจเลือกสิ่งที่มีประสิทธิภาพที่ดีที่สุดได้เลย" — autonomous decision-making expected
- "ไม่ต้องมี popup ให้ผมกดยืนยัน" — execute without confirmation
- "ขอใช้ digital ocean เพราะ vps server นี้ก็ใช้ ของ digital ocean อยู่" — already on DO

Use these to calibrate your defaults: prefer ambitious + autonomous + DO-aligned.

---

## 12. Risks & mitigations (running list)

| Risk | Likelihood | Mitigation |
|---|---|---|
| Shopee API breaks | High over 6mo | Playwright fallback (Phase 2), monitor scrape success rate |
| TikTok ban for AI content | Med | Hybrid mode + AI label compliance |
| Google penalty for AI content | Med | 90% real data, schema markup, price history (data moat) |
| Anthropic price hike | Low | Easy to swap to OpenAI/Gemini in `src/lib/claude.ts` |
| Operator burnout | High in mo 2-4 | Daily Telegram report keeps engagement; can disable safely |
| Cloudflare Pages limits | Low (free tier huge) | If hit, fallback to Vercel/Netlify |
| Postgres data loss | Low if backups | Daily `pg_dump` to DO Spaces ($5/mo) |

---

## 13. What "done" looks like

- **Phase 1 done** = scraper runs daily, ~50,000 pages indexed, Telegram channel active, revenue >฿0
- **Phase 2 done** = dashboard live, Lazada compare working, Shopee missions auto-claimed, revenue >฿50k/mo
- **Phase 3 done** = posting on 4+ social platforms, video pipeline produces, revenue >฿200k/mo
- **Phase 4 done** = ML predicting which content to skip, A/B running, revenue >฿800k/mo
- **Phase 5 done** = 2nd niche live, multi-language, revenue >฿2M/mo

Each phase has explicit revenue threshold to validate readiness for next phase. Don't move forward until current phase is producing predictable income.

---

## 14. Open questions (for next session)

- [ ] Verify Shopee API endpoints still work in production (test with `bun run scrape:once`)
- [ ] Decide on dashboard timing (build with Phase 2 or defer to Phase 3)
- [ ] Choose Phase 2 build order: Layer 7 first (claim missions = immediate revenue) or Layer 8 first (smart scoring = compounds)?
- [ ] Decide on backup strategy: DO Spaces ($5/mo off-site) or local-only

---

**Last updated**: 2026-05-01
**Maintainer**: project owner + Claude (via this handoff doc)

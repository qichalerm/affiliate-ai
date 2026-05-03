# affiliate-ai (V2)

> AI-driven affiliate marketing engine for Shopee + TikTok Shop (Thailand).
> Closed-loop self-learning system: scrape → analyze → generate → publish → measure → tune → repeat.

**Status:** Sprint 0 — foundation skeleton (this commit).
**See:** `docs/development-plan.md` for the full 12-sprint roadmap.

---

## Affiliate sources (locked)

- ✅ Shopee (via shp.ee + Shopee Affiliate Pro)
- ✅ TikTok Shop (via TikTok Shop affiliate)

## Marketing channels (locked)

- ✅ Facebook Page (auto via Meta Graph API)
- ✅ Instagram Business (auto via Meta Graph API)
- ✅ TikTok (auto, 1 account, after API approve)
- ✅ Shopee Video (gen video → manual upload, 5 min/day)
- ✅ Google + SEO (sitemap + IndexNow)
- ✅ Website (Astro static + Cloudflare Pages)

---

## Quick start (local dev)

```bash
# 1. Install deps
bun install

# 2. Copy env template + fill in credentials
cp .env.example .env
$EDITOR .env

# 3. Push schema to Postgres
bun run db:push

# 4. Smoke test (runs all jobs once then exits)
bun run scheduler:once

# 5. Long-running scheduler
bun run scheduler
```

---

## Architecture (9 modules)

```
M0 Operations            (cron, cost cap, alerts)
M1 Source Layer          (Apify Shopee + TikTok Shop scrapers)
M2 Signal Analyzer       (score, trend velocity, competition)
M3 Brain / Decider       (multi-armed bandit + LLM judgment)
M4 Content Engine        (text/image/voice/video, multi-variant)
M5 Multi-Channel         (FB/IG/TikTok publishers, Shopee Video helper)
M6 Promo Hunter          (auto-detect platform special % campaigns)
M7 Engagement Tracker    (pull platform analytics)
M8 Attribution           (CF Pages Function /go/[id] click tracking)  ← Sprint 1
M9 Learning Optimizer    (nightly bandit weight update)
```

---

## Stack

- **Runtime:** Bun + TypeScript (strict)
- **DB:** Postgres 16 + Drizzle ORM
- **Web:** Astro static + Cloudflare Pages
- **AI:** Anthropic Claude (Haiku + Sonnet + Opus tiers)
- **Scrape:** Apify (`xtracto/shopee-scraper`)
- **Voice:** ElevenLabs (Thai voice clone)
- **Image:** Replicate / Flux
- **Video:** Kling / Sora / Runway (selective)
- **Hosting:** DigitalOcean Droplet + Cloudflare Pages

---

## License

Private — not for redistribution.

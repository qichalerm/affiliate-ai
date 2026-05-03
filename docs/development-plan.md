# Development Plan — Shopee Affiliate AI System

> **Status as of 2026-05-03**: Phase 1 LIVE in production — full auto-pipeline (scrape → build → deploy → Telegram broadcast) verified working 24/7. Roadmap rewritten to put marketing-channel automation as the spine of Phase 2-5.

---

## TL;DR

- **5 phases** total, marketing-channel automation as the priority axis
- **Phase 1 = ✅ LIVE** — single-channel (Telegram) auto pipeline running
- **Phase 2 = next** — expand to 5 channels in 1-2 weeks (LINE OA, Email, Twitter, Web)
- **Phases 3-5** stage in visual channels, intelligence/optimization loop, then video + multi-account scale
- **Target end-state**: 100% auto across 13+ marketing channels with self-optimizing budget allocation
- **Total time to Phase 5 complete**: ~3-4 months
- **Total monthly cost at Phase 5**: ~$200/month (≈฿7,000)
- **Revenue target Phase 5**: ฿50k-200k/month

---

## Phase 1 — Foundation ✅ LIVE

**Goal**: Working pipeline from Shopee → DB → web pages → Telegram broadcast, end-to-end auto.

**Status**: Live since 2026-05-01. End-to-end auto-cycle verified 2026-05-03.

**What's running**:
- Apify Shopee scraper, 4 rounds/day (08:00, 13:00, 19:00, 22:00 BKK) on flash-sale windows
- Auto-rebuild + Cloudflare Pages deploy after every successful scrape
- Content generation: review pages, best-of, comparison, internal links (Claude Haiku 4.5)
- Telegram broadcast: 9 deal posts/day to `@priceth_deals` (welcome + photo set)
- Sitemap + Bing IndexNow auto-submit nightly
- Health check every 5 min + daily report 21:00 BKK
- 300 active products, 100 reviews, 14 best-of, 6 comparison published
- Sitemap: 122 URLs, submitted to Google Search Console

**Cost actual**: ~$30/month (Apify $29 + Anthropic ~$1)

**Marketing channels active: 1** (Telegram)

**Outstanding from Phase 1**:
- 0 Telegram subscribers — user share `t.me/priceth_deals` to seed first 50-100 (no API workaround for this — needs human social proof)
- 9 commits pending push to GitHub (user supplies token per the GitHub-push-explicit rule)
- Manual GSC URL submit (10 priority URLs, ~10 min, optional speed boost)

---

## Phase 2 — Multi-Channel Activation

**Goal**: Expand from 1 → 5 marketing channels using free/no-review APIs.

**Time estimate**: 1-2 weeks (most blocked on user actions, not code).

**Tasks**:

| # | Task | User action | My action | Time |
|---|------|-------------|-----------|------|
| 2.1 | Sign up LINE Official Account | yes | guide | 15 min |
| 2.2 | Wire LINE OA broadcast (3x/day) | — | code | 1 hr |
| 2.3 | Sign up Mailgun (free 5000/mo) | yes | guide | 15 min |
| 2.4 | Email weekly digest (Friday) | — | code (template exists) | 30 min |
| 2.5 | Twitter dev account + Free tier API | yes | guide | 30 min |
| 2.6 | Twitter auto post (3 deals/day) | — | wire (publisher exists) | 30 min |
| 2.7 | Short.io domain setup | yes | guide | 10 min |
| 2.8 | Telegram subscriber growth | yes (share link) | — | ongoing |

**New content formats added** (Claude-gen):
- Educational posts (วิธีเลือก X, X vs Y comparison guides)
- FAQ posts (Q&A format)
- Brand spotlight (single-brand deep-dive)

**Cost delta**: $0/month (all free tiers)

**Success metrics**:
- 100+ Telegram subscribers
- 50+ LINE friends
- 100+ email subscribers
- GSC: 100+ impressions/day

**Channels active end of phase: 5** (Telegram + LINE + Email + Twitter + Web)

---

## Phase 3 — Visual Channels

**Goal**: Add image-heavy channels (Pinterest, Meta, YouTube) with auto image generation.

**Time estimate**: 3-4 weeks (waiting on platform approvals).

**Tasks**:

| # | Task | User action | My action | Wait |
|---|------|-------------|-----------|------|
| 3.1 | Pinterest dev account + approval | yes | guide | 1-2 days |
| 3.2 | Pinterest auto pin (10/day) | — | code (publisher exists) | 1 hr |
| 3.3 | Meta dev account (FB + IG) | yes | guide | 3-7 days |
| 3.4 | FB Page + IG Business setup | yes | guide | 30 min |
| 3.5 | Meta auto post (FB + IG carousels) | — | code | 2-3 hr |
| 3.6 | YouTube OAuth + Data API | yes | guide | 30 min |
| 3.7 | YouTube Shorts (still images) | — | code | 1-2 hr |
| 3.8 | **Image generation pipeline (Flux Pro)** | yes (account) | code | 2 hr |

**New content formats added**:
- Visual listicles (top 10 with images) — Pinterest, IG carousel
- Story-form long posts (300-500 words) — FB
- Brand spotlight visuals — IG single posts
- Quote graphics — generated images for embed

**Cost delta**: $25-60/month (Flux ~$25, Mailgun if growing ~$0-35)

**Success metrics**:
- Pinterest: 1000+ saves/month
- IG: 500+ followers
- YT Shorts: 1000+ views/video
- Total visitors: 1000-3000/day

**Channels active end of phase: 9**

---

## Phase 4 — Intelligence Loop

**Goal**: System learns from real metrics and auto-optimizes content/budget/timing.

**Time estimate**: 5-7 weeks.

**Tasks**:

| # | Task | User action | My action |
|---|------|-------------|-----------|
| 4.1 | OAuth refresh-token GSC ingest (bypasses org policy block) | one-time auth click | code OAuth flow |
| 4.2 | Cloudflare Analytics API ingest | provide CF token | code |
| 4.3 | Shopee affiliate dashboard scrape (Playwright) | — | code |
| 4.4 | Per-channel attribution (UTM + SubID end-to-end) | — | code |
| 4.5 | A/B testing framework (headlines, CTAs) | — | code |
| 4.6 | Auto-budget allocator per keyword | — | code |
| 4.7 | Auto post-time optimizer per channel | — | code |
| 4.8 | Quality gate (toxicity + factuality before send) | — | code |
| 4.9 | Cost kill-switch + budget caps | — | code |

**Auto decisions every night 03:00 BKK**:
- High-CTR keyword + low conversion → fix landing page (rewrite verdict)
- High-impression + low-CTR → A/B test 5 headline variants
- Trending keyword detected → spawn 10 content pieces immediately
- Low-converting product → blacklist + remove from broadcast
- Channel underperforming → reduce frequency / change format

**Cost delta**: +$30/month (extra Anthropic for variant generation)

**Success metrics**:
- Telegram CTR > 5%
- Affiliate conversion > 1%
- Cost per acquisition halved
- First real revenue: ฿5,000-15,000/month

**Channels active end of phase: 9** (same channels but smarter)

---

## Phase 5 — Scale & Premium

**Goal**: TikTok + auto video generation + voice clone + multi-account farming.

**Time estimate**: 2-3 months (TikTok approval is the long pole).

**Tasks**:

| # | Task | User action | My action |
|---|------|-------------|-----------|
| 5.1 | TikTok Content Posting API approval | submit (~30 day review) | guide |
| 5.2 | Voice clone setup (ElevenLabs) | record 3-min sample | wire |
| 5.3 | Video generation pipeline (Sora 2 / Kling) | account + billing | code |
| 5.4 | Auto subtitle (Submagic) | account | code |
| 5.5 | TikTok auto upload | — | code |
| 5.6 | **Multi-account farming (3-5 TikTok accs)** | manage accounts | code |
| 5.7 | LinkedIn (B2B niche, optional) | dev account | guide + wire |
| 5.8 | Threads (Meta) | uses Meta creds | code |
| 5.9 | Real-time trending hijack (Twitter trends → content) | — | code |

**New content formats added**:
- Video reviews 60-90s (auto-gen + voice clone narration)
- TikTok trend videos (jump on trends within hours)
- Live commerce hooks (LINE Shopping integration)

**Cost delta**: +$70-120/month (ElevenLabs $22, video gen $50-100 selective)

**Success metrics**:
- TikTok: 10k-1M views/clip viral potential
- Revenue: ฿50k-200k/month

**Channels active end of phase: 13+**

---

## Cost & Channel Summary

| Phase | Time to complete | Monthly cost | Channels active | Reach multiplier |
|-------|------------------|--------------|-----------------|-------------------|
| 1 ✅ | DONE | $30 | 1 | seed |
| 2 | 1-2 weeks | $30 | 5 | 10× |
| 3 | +3-4 weeks | $55-90 | 9 | 50× |
| 4 | +5-7 weeks | $85-120 | 9 + smart | 100× conversion |
| 5 | +2-3 months | $155-240 | 13+ | 500× |

**Cumulative time**: ~3-4 months from now to full Phase 5
**Cumulative cost cap**: ~$240/month (≈฿8,500) at Phase 5 fully running

---

## What Auto-Marketing CANNOT Do (and the workaround)

These channels matter for Thai e-commerce but cannot be legitimately automated:

| Channel | Why blocked | Workaround |
|---------|-------------|------------|
| Pantip | No public API + bot detection | I generate post drafts daily; user posts (5 min/day) |
| Facebook Groups | TOS forbids automation, ban risk | Same — drafts + manual post |
| Lemon8 | No public API | Same — drafts + manual post |
| Reddit Thailand | Strict rate limits + small community | Marginal value, deprioritize |

→ Plan to budget 5-10 min/day for user to post 1-2 drafts in 1-2 priority semi-auto channels.

---

## Marketing Channel Matrix (post-Phase 5)

```
FULLY AUTO (no human in loop):
  Telegram, LINE OA, Email, Twitter, Pinterest, FB Page, IG Business,
  YouTube, TikTok, LinkedIn, Threads

SEMI-AUTO (system gens, user posts):
  Pantip, FB Groups, Lemon8

MANUAL (always human):
  DM responses, comment engagement, influencer outreach
```

---

## Critical Path & Dependencies

**Things only the user can unblock:**
1. Account signup (each platform requires user identity)
2. OAuth/dev approval submissions (each platform requires user as the developer)
3. Domain ownership verification (DNS-level)
4. Telegram subscriber acquisition (no API for "share to Pantip")
5. Pantip / FB-group manual posting (no automation possible)
6. GitHub push (per project rule — explicit token each time)
7. Strategic decisions (niche expansion, budget changes, killing underperformers)

**Things I do autonomously now (per saved feedback):**
1. Code changes + local commits
2. Bug fixes during audits/debugging
3. Run scrapes, content gens, deploys
4. Restart services, edit .env
5. Cleanup demo/test data
6. Tune thresholds, budget, scoring

**Things I always confirm before doing:**
1. Force-push, drop tables, delete user data
2. Schema migrations on production data
3. Cancel subscriptions or change billing
4. Spend that exceeds set budget caps

---

## Operating Rhythm (post-Phase 2)

**Per scrape cycle (4×/day, all auto)**:
```
:00  Apify scrape 2 keywords × 15 products
:01  Persist to DB
:01  triggerSiteRebuild → Astro build → Cloudflare deploy
:30  Re-score products (Layer 8)
+1h  Generate content for new products (Claude)
+1h  Broadcast top deals to Telegram + LINE + Twitter
```

**Per night (auto)**:
```
05:00  Pull GSC + Cloudflare Analytics → DB
23:00  Sitemap rebuild + IndexNow + GSC ping
03:00  Cleanup logs (Sundays)
03:00  Auto-optimize loop (Phase 4+): rebalance budget, A/B verdict, spawn trending content
```

**Per week (user)**:
```
- Check Telegram subscriber count
- Check GSC top queries → confirm content matches
- Approve any flagged compliance issues
- Push pending commits to GitHub
- Decide on niche/budget changes from data
```

---

## Memory & Context Hand-off

`MEMORY.md` references:
- `project_phase1_live.md` — current production snapshot
- `feedback_autonomous_fix.md` — fix-without-asking permission
- `feedback_github_push.md` — explicit-push-only rule

Future Claude sessions reading these files will know exactly what's running, what's pending, and how to act on bugs without re-litigating the architecture.

---

## Open Questions for User to Decide

Before starting Phase 2:
1. Budget cap per month? (suggest $50 cap during Phase 2-3 → $250 cap by Phase 5)
2. Priority — traffic, conversion, or brand? (changes which channels go first)
3. Niche — stay IT gadget, or expand to beauty/home/sports? (each new niche = +keywords + +Apify cost)
4. Manual semi-auto willingness — willing to spend 5-10 min/day on Pantip/FB-group posting?

Answers shape Phase 2-5 priorities. Default if user doesn't decide: "traffic first, IT-gadget only, no manual posting" → conservative path.

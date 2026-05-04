# Environment Variables Setup Guide

`.env` reference — ranked by priority (P0 = blocks revenue, P4 = optional polish).

The Zod schema in `src/lib/env.ts` is authoritative. This doc explains what each
variable does, where to get it, and what activates when it lands.

---

## Already configured (production)

These are filled in `.env` on the live droplet:

| Var | Source | Notes |
|---|---|---|
| `DATABASE_URL` | `scripts/setup-postgres.sh` generates | Postgres 16 localhost-only |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Funds translations + variant gen |
| `APIFY_TOKEN` | apify.com | Shopee scraper (residential TH proxy) |
| `CLOUDFLARE_ACCOUNT_ID` / `_API_TOKEN` / `_ZONE_ID` / `_PAGES_PROJECT` | Cloudflare dashboard | Pages deploy + Tunnel + DNS |
| `SHOPEE_AFFILIATE_ID` | affiliate.shopee.co.th | Embedded in fallback URL when shp.ee not yet generated |
| `SITE_DOMAIN` / `SITE_NAME` / `SITE_OUT_DIR` | manual | `example.com`, `Affiliate AI`, `./dist` |
| `INTERNAL_AUTH_SECRET` | `openssl rand -hex 32` | Shared secret between Pages Function and droplet |

---

## 🔴 P0 — Blocks revenue (apply first)

### Shopee Open Affiliate API

```
SHOPEE_API_KEY=
SHOPEE_API_SECRET=
```

**Why:** Without these, every click on example.com → Shopee gets 0 commission attribution. Shopee only credits affiliate clicks that come through their `shope.ee/xxx` short links, which we mint via this API.

**How to get:**
1. Go to https://affiliate.shopee.co.th/open_api
2. Click **Apply for Open API access**
3. Fill the application (App name: `affiliate-ai`, Website: `https://example.com`, brief description of usage)
4. Submit → wait **1–3 business days** for Shopee approval
5. Once approved, you'll receive App ID + App Secret

**Activation after keys arrive:** see [ACTIVATION.md §1](ACTIVATION.md).

---

## 🟠 P1 — Marketing channels (after P0)

### Meta (Facebook + Instagram)

```
META_APP_ID=
META_APP_SECRET=
META_PAGE_ID=
META_PAGE_ACCESS_TOKEN=        # long-lived (60-day)
META_INSTAGRAM_BUSINESS_ID=
FEATURE_META_AUTO_POST=true    # default false; toggle on after tokens land
```

**Why:** Enables `autoPublish` cron to post promo content to your FB Page + IG Business account every 30 min during 8 AM–10 PM BKK (max 5 posts/day per channel).

**How to get:**
1. https://developers.facebook.com → My Apps → **Create App** (Type: Business)
2. Add products: **Facebook Login** + **Instagram Graph API**
3. You need:
   - A Facebook Page where you're admin
   - An Instagram Business Account linked to that Page
4. **Graph API Explorer**:
   - Get a User Access Token with scopes: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`
   - Use the token to query `/me/accounts` → copy the Page Access Token + Page ID
5. **Exchange for long-lived token** (~60 days):
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={SHORT_LIVED_PAGE_TOKEN}
   ```
6. **Get IG Business ID**:
   ```
   GET https://graph.facebook.com/v21.0/{PAGE_ID}?fields=instagram_business_account&access_token={PAGE_TOKEN}
   ```

**Effort:** ~30–60 min. App Review may be needed for `pages_manage_posts` if app is "live mode" — for personal use, "development mode" works without review.

---

### TikTok Content Posting API

```
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ACCESS_TOKEN=        # 24h, refresh with refresh_token
TIKTOK_REFRESH_TOKEN=       # 1-year
TIKTOK_OPEN_ID=
FEATURE_TIKTOK_AUTO_POST=true
```

**Why:** Enables `autoPublish` to post short videos to TikTok (3 posts/day default).

**How to get:**
1. https://developers.tiktok.com → **Manage Apps** → Create App
2. Request scopes: `video.upload`, `video.publish`
3. Submit for **App Review** — TikTok is strict, expect **3–7 days** wait
4. After approval, OAuth flow returns access + refresh token + open_id

**Effort:** mostly waiting on TikTok review.

---

## 🟡 P2 — Content quality

### Replicate (image generation via Flux)

```
REPLICATE_API_TOKEN=
```

**Why:** Generate hero images for FB/IG/TikTok posts (instead of using the bare Shopee product photo). Better-looking posts → higher CTR.

**Cost:** ~$0.0050 per image (Flux schnell). At 3 channels × 5 posts/day = 15 images/day = $0.075/day = **~$2.25/mo**.

**How to get:** sign up at https://replicate.com → API Tokens → create. Add credit card, set $5–$10 starter budget.

### ElevenLabs (Thai voice clone)

```
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=
ELEVENLABS_MODEL=eleven_multilingual_v3   # default ok
```

**Why:** Voice narration for TikTok videos. Without this, TikTok videos are silent slideshows (lower CTR).

**Cost:** Starter plan $5/mo gives 30k chars (~30 min audio). Pro $22/mo = 100k chars.

**How to get:**
1. https://elevenlabs.io → sign up → upgrade to Starter+
2. **Voice Lab** → either pick a default Thai voice or clone your own (record 1 min sample)
3. Copy Voice ID from voice library

---

## 🟢 P3 — Operations + SEO

### Resend (operator email — daily report + alerts)

```
RESEND_API_KEY=
EMAIL_FROM=alerts@example.com   # optional; uses noreply default if unset
OPERATOR_EMAIL=                  # your inbox
```

**Cost:** Free tier 100 emails/day. Plenty for daily report (1 email) + alerts.

**How to get:** https://resend.com → API Keys → Create. Verify domain (or use their sandbox for testing).

### Google Search Console (organic traffic data)

```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REFRESH_TOKEN=
GOOGLE_SEARCH_CONSOLE_PROPERTY=sc-domain:example.com
```

**Why:** See what queries bring users to example.com. Currently we know clicks but not search intent.

**How to get:**
1. console.cloud.google.com → create project → enable **Search Console API**
2. OAuth consent screen → add scope `https://www.googleapis.com/auth/webmasters.readonly`
3. Create OAuth Client ID (type: Desktop)
4. Run a one-time auth script to exchange auth code → refresh token

### Bing IndexNow (already auto-derived)

```
BING_INDEXNOW_KEY=    # optional — if blank, auto-derived from domain
```

We auto-derive a stable key from `sha256(SITE_DOMAIN)`. Bing/Yandex/Naver/Seznam are pinged on every site rebuild. If you want a custom key, paste any 32-char hex string.

### Sentry (error monitoring)

```
SENTRY_DSN=
```

Optional. We log errors to journalctl already; Sentry adds aggregation + alerts. Free tier covers small projects.

---

## 🔵 P4 — Optional source diversity

### TikTok Shop scraper

```
TIKTOK_SHOP_ACTOR_ID=    # e.g. "clockworks/tiktok-shop-scraper"
```

**Why:** Add TikTok Shop products alongside Shopee. Code scaffold ready in `src/scraper/tiktok-shop/`.

**How to get:**
1. Browse https://apify.com/store?search=tiktok+shop
2. Pick an actor that's actively maintained (check last-updated date + reviews)
3. Paste its full id (e.g. `clockworks/tiktok-shop-scraper`)
4. Restart scheduler — `scrapeTikTokShop` cron starts firing 3×/day

**Note:** Actor input/output schemas vary. You may need to refine `src/scraper/tiktok-shop/apify-client.ts` parser to match.

### Premium video gen (replaces ffmpeg slideshow)

```
KLING_API_KEY=
SORA_API_KEY=
RUNWAY_API_KEY=
```

Optional. Currently TikTok videos are assembled with ffmpeg (image + voice + text overlay → MP4). Premium video models would replace this with proper motion video. Not wired yet — needs additional `src/content/video-models/` work.

### Submagic (auto-captions)

```
SUBMAGIC_API_KEY=
```

Optional. For burned-in captions on TikTok videos. Not wired.

---

## Tuning knobs (defaults are sensible)

```
# Niche scrape budget
PRIMARY_NICHE=all
SCRAPE_KEYWORDS_PER_RUN=4              # how many keywords per scrape tick
SCRAPE_PRODUCTS_PER_KEYWORD=15

# Cron schedule (BKK)
CRON_SCRAPE_PRODUCTS=0 8,13,19,22 * * *

# Daily budget caps
DAILY_LLM_BUDGET_USD=10
DAILY_VIDEO_GEN_BUDGET_USD=10
DAILY_IMAGE_GEN_BUDGET_USD=3
DAILY_VOICE_GEN_BUDGET_USD=2

# Per-channel post caps (V2 vision: anti-bot)
DAILY_POSTS_FACEBOOK=5
DAILY_POSTS_INSTAGRAM=5
DAILY_POSTS_TIKTOK=3

# Auto-deploy
AUTO_DEPLOY_AFTER_REBUILD=true
SITE_REBUILD_DEBOUNCE_MS=300000        # 5 min coalescing window

# Site builder
SITE_DOMAIN=example.com
SITE_NAME=Affiliate AI
SITE_OUT_DIR=./dist

# Internal auth (rotate occasionally — must match between droplet + Pages env vars)
INTERNAL_AUTH_SECRET=               # openssl rand -hex 32

# Feature flags (default false — flip when ready)
FEATURE_META_AUTO_POST=false
FEATURE_TIKTOK_AUTO_POST=false
FEATURE_AI_BRAIN=false
FEATURE_PROMO_HUNTER=false
FEATURE_AUTO_TRANSLATE=false

# Debug
DEBUG_DRY_RUN=false                 # true = no real posts, no real spend
```

---

## Security

- `.env` permission must be `600` — verified via systematic audit
- `INTERNAL_AUTH_SECRET` is the shared secret between Cloudflare Pages Function and the droplet's redirect-server. Rotate when you change ownership.
- Never commit `.env`. Verify `.gitignore` includes it (it does).
- Service accounts use least-privilege tokens (e.g. CF API token has only Pages/Tunnel/DNS edit, not full account access).

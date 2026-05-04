# Activation Guide

Step-by-step for what to do **after** API keys arrive. Each section is
self-contained — do them in P0 → P3 order; each unlocks more autonomous
behaviour.

System is currently running 24/7 in dry-run mode for everything that needs keys.
Activation = paste keys → restart → verify. No code changes needed.

---

## §1. Shopee Open Affiliate API (P0 — most important)

**Effect:** Every click on example.com → Shopee starts crediting commission.
Without this, our /go/ tracker logs clicks correctly but Shopee dashboard
shows 0 commission.

### Steps

1. **Paste keys into `/root/affiliate-ai/.env`:**
   ```
   SHOPEE_API_KEY=your_app_id_here
   SHOPEE_API_SECRET=your_app_secret_here
   ```

2. **Restart services:**
   ```bash
   systemctl restart affiliate-ai-redirect affiliate-ai-scheduler
   ```

3. **Backfill `shp.ee` short links for existing 700+ affiliate links** (one-shot):
   ```bash
   cd /root/affiliate-ai
   bun run backfill:shopee-shortlinks
   ```
   Takes ~10 min at ~50 req/min throttle. Idempotent — re-runnable safely.

4. **Verify:**
   ```bash
   psql "$(grep ^DATABASE_URL .env | cut -d= -f2)" -c \
     "SELECT COUNT(*) FILTER (WHERE shopee_short_url IS NOT NULL) || '/' || COUNT(*) AS \"shp.ee_coverage\" FROM affiliate_links"
   ```
   Should show `~743/743` after backfill completes.

5. **Smoke-test end-to-end click:**
   ```bash
   SHORT=$(curl -s "https://example.com/th/" | \
           grep -oE 'href="/th/p/[^"]+"' | head -1 | \
           xargs -I{} curl -s "https://example.com{}" | \
           grep -oE 'href="https://example.com/go/[A-Za-z0-9]+"' | head -1 | \
           sed 's|.*go/||;s|"$||')
   curl -sI "https://example.com/go/$SHORT" | grep location
   # Should show: location: https://shope.ee/<random>
   ```

That's it. From this moment forward every existing + new affiliate link funnels
through `shope.ee/xxx` and Shopee's dashboard credits commission within 24h.

---

## §2. Meta (Facebook + Instagram)

**Effect:** `autoPublish` cron starts posting to your FB Page + IG Business
account every 30 min during 8 AM–10 PM BKK. Max 5 posts/day per channel
(rate-limit per V2 vision anti-bot policy).

Pre-requisites: see [env-setup.md §P1](env-setup.md#-p1--marketing-channels-after-p0)
for how to obtain the tokens.

### Steps

1. **Paste keys into `.env`:**
   ```
   META_APP_ID=...
   META_APP_SECRET=...
   META_PAGE_ID=...
   META_PAGE_ACCESS_TOKEN=...   # long-lived 60-day
   META_INSTAGRAM_BUSINESS_ID=...
   FEATURE_META_AUTO_POST=true
   ```

2. **Restart scheduler:**
   ```bash
   systemctl restart affiliate-ai-scheduler
   ```

3. **Smoke-test (sanity-check FB credentials):**
   ```bash
   cd /root/affiliate-ai
   bun run test:publish:fb
   ```
   Should post one test variant to your FB Page (or skip with reason if
   FEATURE_META_AUTO_POST=false / no approved variants).

4. **Wait for first auto-publish tick:**
   Cron `autoPublish` runs at `:10` and `:40` past every hour, 8AM–10PM BKK.
   Check logs:
   ```bash
   journalctl -u affiliate-ai-scheduler --since "1 hour ago" | grep autoPublish
   ```
   You should see: `auto-published channel=facebook productId=N platformPostId=...`

5. **Token expiry reminder:**
   META Page Access Token is 60-day. Set a calendar reminder day 50 to refresh:
   ```
   GET https://graph.facebook.com/v21.0/oauth/access_token
     ?grant_type=fb_exchange_token
     &client_id={APP_ID}
     &client_secret={APP_SECRET}
     &fb_exchange_token={CURRENT_TOKEN}
   ```
   Then update `.env` and restart scheduler.

---

## §3. TikTok

**Effect:** `autoPublish` posts videos to your TikTok account (3/day default).

### Steps

1. **Paste keys:**
   ```
   TIKTOK_CLIENT_KEY=...
   TIKTOK_CLIENT_SECRET=...
   TIKTOK_ACCESS_TOKEN=...
   TIKTOK_REFRESH_TOKEN=...
   TIKTOK_OPEN_ID=...
   FEATURE_TIKTOK_AUTO_POST=true
   ```

2. Restart: `systemctl restart affiliate-ai-scheduler`

3. **Verify cron registers:**
   ```bash
   journalctl -u affiliate-ai-scheduler --since "30 sec ago" | grep autoPublish
   ```

4. **Token refresh:** TikTok access token is 24h. The refresh token is 1 year.
   The publisher module currently does NOT auto-refresh — TODO sprint to add.
   For now, manually rotate access_token from refresh_token before expiry,
   or ignore until refresh logic lands.

---

## §4. Replicate (image generation) [optional]

**Effect:** Posts get hero images from Flux instead of bare Shopee photos.

1. **Paste key:**
   ```
   REPLICATE_API_TOKEN=...
   ```
2. Restart: `systemctl restart affiliate-ai-scheduler`
3. Verify next auto-publish uses generated image (check `published_posts.image_url`).

Current cost: ~$0.005/image × 15 posts/day = ~$2/mo.

---

## §5. ElevenLabs (Thai voice) [optional]

**Effect:** TikTok videos get voice narration instead of being silent.

1. **Paste keys:**
   ```
   ELEVENLABS_API_KEY=...
   ELEVENLABS_VOICE_ID=...
   ```
2. Restart scheduler.
3. Verify next TikTok video has audio: download from `dist/videos/` or check S3.

---

## §6. Resend (operator email) [optional]

**Effect:** Daily report email at 08:00 BKK + alert emails when source-health
detects degraded scrapers.

1. **Paste keys:**
   ```
   RESEND_API_KEY=...
   OPERATOR_EMAIL=you@example.com
   EMAIL_FROM=alerts@example.com   # optional
   ```
2. Restart scheduler.
3. Test:
   ```bash
   bun -e 'import {runDailyReport} from "./src/monitoring/daily-report.ts"; await runDailyReport(); process.exit(0)'
   ```
   Email should arrive in 2–5 sec.

---

## §7. Verifying full autonomous flow

After any activation, run this end-to-end check:

```bash
cd /root/affiliate-ai

# 1. All services healthy
for s in affiliate-ai-scheduler affiliate-ai-redirect cloudflared postgresql; do
  printf "%-30s %s\n" "$s" "$(systemctl is-active $s)"
done

# 2. Recent scrape activity
psql "$(grep ^DATABASE_URL .env | cut -d= -f2)" -c \
  "SELECT MAX(last_scraped_at) AS last_scrape, COUNT(*) FROM products WHERE is_active"

# 3. Recent deploy
bun -e 'import {config} from "dotenv"; config(); const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/pages/projects/${process.env.CLOUDFLARE_PAGES_PROJECT}/deployments?per_page=1`, { headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` } }); const j = await r.json(); console.log("last deploy:", j.result[0].created_on)'

# 4. Site live
curl -sI https://example.com/th/ | head -3

# 5. Click flow
curl -s "https://example.com/th/" | grep -oE 'href="/go/[A-Za-z0-9]+"' | head -1
# (should print href; then curl that URL → expect 302 to shope.ee or shopee.co.th)
```

All checks should be ✅ green.

---

## §8. Rollback / disable

To stop auto-publishing without removing keys:
```
FEATURE_META_AUTO_POST=false
FEATURE_TIKTOK_AUTO_POST=false
```
then `systemctl restart affiliate-ai-scheduler`.

To stop everything (full pause):
```bash
sudo systemctl stop affiliate-ai-scheduler affiliate-ai-redirect cloudflared
```
Site stays live (Cloudflare Pages serves cached HTML) but no new scrapes / posts / clicks happen.

To resume:
```bash
sudo systemctl start cloudflared affiliate-ai-redirect affiliate-ai-scheduler
```

---

## §9. What if something breaks

Common issues + fixes are in [HANDOFF.md §8 (Critical gotchas)](HANDOFF.md#8-critical-gotchas-the-things-that-bite). Top three:

1. **Auto-deploy fails silently** → check `journalctl -u affiliate-ai-scheduler | grep "auto-deploy"`. If "bunx not found", that's the systemd PATH bug — should already be fixed in current code.

2. **Shopee dashboard shows 0 commission** → SHOPEE_API_KEY hasn't been added or backfill didn't run. See §1.

3. **`/en/`, `/zh/`, `/ja/` pages show fewer products than `/th/`** → translation backfill is catching up. Wait 45 min for next cron tick, or run manually:
   ```bash
   bun -e 'import {translateMissingProducts} from "./src/translation/translator.ts"; await translateMissingProducts({limit:500}); process.exit(0)'
   ```

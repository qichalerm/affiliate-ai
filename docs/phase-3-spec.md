# Phase 3 Spec — Social Distribution

> **Goal**: Auto-post to TikTok, Facebook, Instagram, YouTube. Generate video + voice + images. 1 story → 8 channel formats.
> **Trigger to build**: Phase 2 stable for ≥4 weeks, ≥฿30k/mo revenue, TikTok + Meta dev accounts approved.
> **Estimated build effort**: 2-3 chat sessions, ~35-40 new files. Most complex phase.
> **New monthly cost when running**: +$90 (~$220 total).

---

## Layer introduced

**Layer 9** — Narrative Content Engine

```
[Story Trigger] (event/season/trend)
    → [Story Generator] (LLM creates plot + product slots)
    → [Asset Factory] (voice + image + video + music)
    → [Multi-Format Assembler]
        ├─ TikTok 30s
        ├─ FB/IG Reels
        ├─ YT Shorts + long-form
        ├─ Pinterest pins
        ├─ Twitter thread
        ├─ Carousel (FB/IG)
        ├─ Telegram broadcast
        └─ Email newsletter
    → [Drip Scheduler]
    → [Multi-Platform Publisher]
```

---

## Build order

1. **Voice generation (ElevenLabs)** — needed by everything
2. **Image generation (Flux/Replicate)** — Pinterest + carousel use this
3. **Video assembler (Remotion + FFmpeg)** — most complex
4. **Story engine** — orchestrates assets
5. **Multi-format assembler** — turn 1 story into N formats
6. **Drip scheduler** — release across platforms over time
7. **Platform publishers** — TikTok → Meta → YouTube → Twitter → Lemon8

---

## Files to create

### Voice / image / video / music

```
src/voice/
├── elevenlabs.ts                   # API client
├── voice-clone.ts                  # upload sample, get voice_id
└── narration.ts                    # script → mp3, with prosody control

src/image/
├── flux.ts                         # Flux Pro via Replicate
├── canva.ts                        # optional: Canva API for templates
└── thumbnail-generator.ts          # YT thumbnails (3 variants for A/B)

src/video/
├── remotion/
│   ├── package.json                # separate Remotion install
│   ├── src/
│   │   ├── compositions/
│   │   │   ├── ProductReel.tsx     # 30s vertical product video
│   │   │   ├── ComparisonReel.tsx  # A vs B compare
│   │   │   ├── DealReel.tsx        # flash sale countdown
│   │   │   └── StoryReel.tsx       # narrative-driven
│   │   └── components/
│   │       ├── PriceTag.tsx
│   │       ├── Captions.tsx
│   │       └── ProductImage.tsx
│   └── render.ts                   # programmatic render entry
├── ffmpeg.ts                       # post-processing (compress, crop, watermark)
├── b-roll-fetcher.ts               # Pexels API for ambient shots
└── format-export.ts                # 9:16 / 16:9 / 1:1 variants

src/music/
└── suno.ts                         # optional: BGM generation

src/captions/
└── submagic.ts                     # auto captions API
```

### Story engine

```
src/narrative/
├── story-engine.ts                 # main orchestrator
├── triggers/
│   ├── calendar.ts                 # holidays, sales events
│   ├── weather.ts                  # heatwave, rain → product boost
│   ├── trends.ts                   # TikTok/Twitter trending
│   └── persona.ts                  # ongoing series (e.g. "WFH mom")
├── prompts/
│   ├── story-plot.ts               # generate 3-act structure
│   ├── scene-breakdown.ts          # per scene: visual + voiceover
│   └── caption-variants.ts         # 8 platform-specific captions
├── product-placement.ts            # match products to story slots
└── assembler.ts                    # story → assets → published_posts
```

### Multi-platform publishers

```
src/publisher/
├── tiktok/
│   ├── client.ts                   # TikTok Content Posting API
│   ├── upload.ts
│   ├── ai-label.ts                 # MUST set true for AI content
│   └── analytics.ts
├── meta/
│   ├── client.ts                   # Graph API
│   ├── facebook-reel.ts
│   ├── facebook-carousel.ts
│   ├── instagram-reel.ts
│   ├── instagram-carousel.ts
│   └── branded-content.ts          # MUST tag affiliate
├── youtube/
│   ├── client.ts                   # YT Data API v3
│   ├── shorts-upload.ts
│   ├── long-form-upload.ts
│   └── analytics.ts
├── twitter/
│   ├── client.ts                   # X API v2
│   └── thread.ts
└── lemon8/
    └── playwright-poster.ts        # no public API, use Playwright
```

### Schema additions

```sql
CREATE TABLE stories (
  id SERIAL PRIMARY KEY,
  trigger_type VARCHAR(32),         -- calendar | weather | trend | persona
  trigger_data JSONB,
  title VARCHAR(512),
  plot_json JSONB,                  -- 3-act structure
  product_slot_ids JSONB,
  status VARCHAR(32),               -- planned | producing | published | flopped
  performance_summary JSONB,        -- aggregated across platforms
  created_at TIMESTAMPTZ DEFAULT now(),
  published_first_at TIMESTAMPTZ
);

CREATE TABLE story_assets (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id) ON DELETE CASCADE,
  kind VARCHAR(32),                 -- video_9_16 | video_16_9 | image | audio | thumbnail
  url TEXT,
  storage_key TEXT,
  generated_by VARCHAR(64),
  cost_usd REAL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE post_queue (
  id SERIAL PRIMARY KEY,
  story_id INTEGER REFERENCES stories(id),
  story_asset_id INTEGER REFERENCES story_assets(id),
  channel VARCHAR(32),
  account_identifier VARCHAR(128),
  scheduled_for TIMESTAMPTZ NOT NULL,
  status VARCHAR(32) DEFAULT 'queued',
  attempts INTEGER DEFAULT 0,
  last_error TEXT
);

CREATE INDEX post_queue_due_idx ON post_queue (scheduled_for) WHERE status = 'queued';
```

---

## Hybrid mode workflow (for TikTok)

If `POSTING_MODE=hybrid` in `.env`:

1. User records 20 takes of themselves on camera (5-10s each) once per week
2. Upload via dashboard → stored in `story_assets` with kind='human_intro'
3. Story engine prefers stories that have a matching human intro available
4. Final video: human_intro (5-10s) + AI b-roll (15-25s) = 30s reel
5. Higher reach than full-AI by 5-10x

If `POSTING_MODE=full_auto`:
- Skip human intro requirement
- Use voice clone + b-roll only
- Accept lower reach

---

## TOS Compliance (CRITICAL)

### TikTok (2026 rules)
- **Must** set `ai_generated_content: true` if any AI involvement
- Must disclose affiliate via `#ad` in caption
- Hashtag limit: 5 most relevant
- Posting frequency: max 30/day per account

### Meta (FB + IG)
- **Must** toggle "Branded Content" for affiliate posts
- AI Info label required if AI-generated visuals
- Reels: max 3/day per Page

### YouTube
- "Altered or synthetic content" disclosure for AI-generated voice/visual
- Affiliate disclosure in description (first 3 lines)

These are auto-applied by `src/compliance/checker.ts` extended for Phase 3.

---

## New env vars

```bash
# Voice
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=                # your cloned voice

# Image
FLUX_API_KEY=
REPLICATE_API_TOKEN=                # alternative

# Captions
SUBMAGIC_API_KEY=

# Music (optional)
SUNO_API_KEY=

# Video gen (optional, expensive)
SORA_API_KEY=                       # OpenAI Sora 2
KLING_API_KEY=

# Stock footage
PEXELS_API_KEY=                     # free 200/hr

# TikTok (must approve dev account first — 2-4 weeks)
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ACCESS_TOKEN=
TIKTOK_REFRESH_TOKEN=

# Meta
META_APP_ID=
META_APP_SECRET=
META_PAGE_ACCESS_TOKEN=
META_PAGE_ID=
META_INSTAGRAM_BUSINESS_ID=

# YouTube
YOUTUBE_API_KEY=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=
YOUTUBE_CHANNEL_ID=

# Twitter (X)
TWITTER_API_KEY=
TWITTER_API_SECRET=
TWITTER_ACCESS_TOKEN=
TWITTER_ACCESS_SECRET=

# Lemon8 (Playwright login)
LEMON8_USERNAME=
LEMON8_PASSWORD=

# Feature flags
FEATURE_LAYER_9_NARRATIVE=true
FEATURE_TIKTOK_AUTO_POST=true
FEATURE_META_AUTO_POST=true
FEATURE_YOUTUBE_AUTO_POST=true
POSTING_MODE=hybrid                  # or full_auto
HUMAN_FACE_INTRO_SECONDS=7
```

---

## Cron additions

```typescript
{ name: "narrativeStoryGen",  cron: "0 6 * * *",      description: "Generate 3-5 stories per day" },
{ name: "narrativeAssetGen",  cron: "0 7,13,19 * * *", description: "Produce assets for queued stories" },
{ name: "publishQueueRunner", cron: "*/15 * * * *",   description: "Publish due posts" },
{ name: "trendDetector",      cron: "*/30 * * * *",   description: "Real-time trend radar" },
```

---

## Cost breakdown (per story produced)

| Asset | Tool | Cost |
|---|---|---|
| Script (LLM) | Claude Haiku | $0.002 |
| Voice (~30s) | ElevenLabs | $0.04 |
| 5 images | Flux | $0.20 |
| Video render (Remotion, local CPU) | $0 | (FFmpeg on Droplet) |
| B-roll fetch (Pexels) | $0 | free tier |
| BGM (Suno) | $0.05 | optional |
| Captions (Submagic) | $0.02 | |
| **Total per story** | | **~$0.30** |

At 5 stories/day = $1.50/day = ~$45/month — fits within `DAILY_VIDEO_GEN_BUDGET_USD=10`.

---

## Validation checklist

- [ ] Voice clone uploaded; narration MP3 sounds natural
- [ ] At least 1 video successfully published to TikTok via API (not Playwright)
- [ ] AI label visible on TikTok post
- [ ] Branded Content tag visible on FB Page post
- [ ] Story engine produces ≥3 stories/day
- [ ] No account warnings or shadowban indicators (reach > 50% baseline)
- [ ] Cross-platform analytics flowing into `published_posts`
- [ ] Revenue from social channels > ฿20k/mo

---

## Risks specific to Phase 3

| Risk | Mitigation |
|---|---|
| TikTok dev approval rejected | Use Playwright fallback (`src/publisher/tiktok/playwright.ts`) |
| AI content reach throttled | Hybrid mode required; monitor reach ratio |
| Voice clone sounds robotic | Train with longer sample (10+ minutes); use eleven_multilingual_v3 |
| Video render takes too long | Render queue; max 2 concurrent on small VPS |
| Disk fills with rendered videos | Auto-delete after publish; only keep masters in R2 |
| Account ban on multi-post | Diversify accounts (3-5 per platform), rotate posting times |

---

**Estimated build time**: 2-3 chat sessions if focused, 6-10 weeks calendar if part-time
**Hardest part**: Remotion video templates + per-platform format quirks
**Dependency**: TikTok dev account approval (apply 4 weeks before starting Phase 3)

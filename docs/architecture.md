# Architecture Overview

## High-level flow

```
                         ┌─────────────────────────┐
                         │   Cron Scheduler        │
                         │   (croner, in-process)  │
                         └────────────┬────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
   ┌─────────┐                  ┌─────────┐                  ┌─────────┐
   │ Scrape  │ Shopee public    │ Generate│ Claude API       │ Publish │ Telegram +
   │ Trending│ JSON endpoints   │ Pages   │ (Haiku/Sonnet)   │ Channel │ Astro build
   └────┬────┘                  └────┬────┘                  └────┬────┘
        │                            │                            │
        ▼                            ▼                            ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                     Postgres (Neon)                             │
   │  products · prices · reviews · shops · content_pages · ...      │
   └─────────────────────────────────────────────────────────────────┘
        │
        ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │   Astro static-site build (reads from DB at build time)         │
   │   → Cloudflare Pages → user                                     │
   └─────────────────────────────────────────────────────────────────┘
```

## Stack summary

| Layer | Tech | Why |
|---|---|---|
| Runtime | **Bun** | Native TS, fastest startup, no transpile step |
| Language | **TypeScript** strict | Single language across server + scraper + web |
| DB | **Postgres 16** (self-host on DO Droplet) + Drizzle ORM | Localhost = zero latency, one bill |
| Scraping | Bun `fetch` + custom client | Public Shopee JSON, no Playwright needed for Phase 1 |
| AI | `@anthropic-ai/sdk` — Haiku 4.5 fast / Sonnet 4.6 smart | Best perf/cost for Thai language |
| Web | Astro static + Tailwind | Fast static SSG, good SEO |
| Hosting | Cloudflare Pages + R2 | Free unlimited bandwidth, low latency in TH |
| Cron | croner (in-process) | Simpler than Kubernetes; one VPS hosts all |
| Telegram | telegraf | Maintained, supports v6+ |
| Logging | pino | Fastest JSON logger |
| Validation | zod | Env, prompt outputs, API responses |

## Layer mapping (system blueprint → code)

| Layer | Description | Source files |
|---|---|---|
| 1 | Data Collection | `src/scraper/shopee/*` |
| 2 | Content Generation | `src/content/*` |
| 3 | Distribution (web) | `src/web/*` |
| 3 | Distribution (social) | `src/publisher/*` |
| 4 | Optimization Loop | (Phase 4 — `src/intelligence/*`) |
| 5 | Monitoring & Alert | `src/monitoring/*` |
| 6 | Self-Healing | `src/lib/retry.ts` + scraper retries |
| 7 | Campaign Optimization | (Phase 2 — `src/intelligence/campaigns.ts`) |
| 8 | Product Intelligence | (Phase 2 — `src/intelligence/scoring.ts`) |
| 9 | Narrative Engine | (Phase 3 — `src/narrative/*`) |
| 10 | Performance Intelligence | (Phase 4 — `src/analytics/*`) |
| 11 | Compliance | `src/compliance/*` |

## Data model

Core tables (full schema in `src/db/schema.ts`):

```
shops ────┐
          │
          ▼
       products ──┬──► product_prices  (history)
                  ├──► product_reviews (snippets for verdict)
                  └──► price_compare   (cross-platform)

products ──► content_pages ──► content_assets
                            └─► published_posts (per channel)

scraper_runs    (job log)
generation_runs (LLM cost log)
alerts          (operator notifications)
compliance_logs (TOS/policy audits)
campaigns       (Shopee promo tracking — Phase 2)
trends          (Layer 8 — Phase 2)
```

Money is stored as **satang** (1 baht = 100 satang) to avoid float rounding.
Times are stored in UTC; rendered in `Asia/Bangkok`.

## Cron schedule (default)

| Cron | Job | What it does |
|---|---|---|
| `0 */6 * * *` | scrapeTrending | 3 random keywords from niche → Shopee API → DB |
| `0 7 * * *` | generatePages | Up to 50 missing review pages (LLM) |
| `0 10,16,20 * * *` | broadcastDeals | Pick 3 deals, push to Telegram channel |
| `*/5 * * * *` | healthCheck | DB ping, bot ping, feature-flag consistency |
| `0 21 * * *` | dailyReport | Telegram summary to operator |
| `0 3 * * 0` | cleanup | Delete scraper_runs >30d, clicks >180d |

Override via env: `CRON_SCRAPE_PRODUCTS`, `CRON_GENERATE_PAGES`, etc.

## Compliance approach

Layer 11 enforces:

1. **Forbidden words** (Thai law) — auto-soften superlatives, block medical claims.
   See `src/compliance/forbidden-words.ts`.
2. **AI disclosure** — auto-prepend "เนื้อหาบางส่วนสร้างโดย AI" on social posts.
3. **Affiliate disclosure** — auto-prepend on all social posts; built into web footer.
4. **Trademark** — pages flagged as risky require human review (Phase 3).

Failures are logged to `compliance_logs` and surface as alerts.

## Runtime topology (Phase 1)

Single DigitalOcean Droplet — Postgres + scheduler colocated:

```
[ DO Droplet — 1 vCPU 2GB ($12/mo) ]
  ├─ Postgres 16 (localhost only)
  ├─ bun src/scheduler/index.ts   (long-running, systemd-managed)
  └─ ad-hoc CLI tasks (scrape:once, generate:once, build:pages)

[ External services ]
  ├─ Anthropic API (Claude)
  ├─ Telegram (alerts + broadcast)
  ├─ Cloudflare Pages (static web — public users hit this, not Droplet)
  ├─ DO Spaces (optional, DB backups, $5/mo)
  └─ Shopee Affiliate API (commissions tracking — Phase 2)
```

## Cost model (Phase 1, monthly)

| Item | Cost |
|---|---|
| DO Droplet (Postgres + scheduler bundled) | $6–12 |
| DO Spaces (optional backups) | $5 |
| Claude API (~50k pages × $0.0008) | ~$40 |
| Cloudflare Pages | $0 |
| Telegram | $0 |
| Domain | $1/mo amortized |
| **Total** | **~$50–60/mo** |

Phase 2+ adds ElevenLabs ($22), proxy ($30), FastMoss ($50), bringing it to ~$200/mo.

## Failure modes & graceful degradation

| Failure | Behavior |
|---|---|
| DB unreachable | Health check alerts; jobs throw, scheduler keeps running |
| Anthropic API down | `generateReviewPage` throws; logged; retried by next cron |
| Anthropic credit out | `complete()` throws 402; alert created; humans must top up |
| Shopee API blocks IP | Scraper logs failure; alert if success rate < 50% |
| Telegram outage | Alerts buffered in `alerts` table; delivered next attempt |
| Cloudflare Pages deploy fail | Site shows last good build (no rollback needed) |

## Testing strategy

- **Smoke**: `bun run check-env` + `bun run test-connections`
- **Scraper**: `bun run scrape:once "keyword"` — manual inspection
- **Generator**: `bun run generate:once 5` — generates 5 pages, prints cost
- **Compliance**: `bun run compliance:check` — audits existing pages
- **Telegram**: `bun run telegram:test`

End-to-end happy path:
```bash
bun install
cd src/web && bun install && cd ../..
bun run check-env
bun run db:push
bun run db:seed
bun run scrape:once หูฟัง 20
bun run generate:once 10
bun run build:pages  # builds Astro, optionally deploys to Cloudflare
```

## Future layers (deferred)

- **Layer 7 — Campaign Optimization**: scrape Shopee Affiliate dashboard, auto-enroll missions, track tier progress
- **Layer 8 — Product Intelligence**: TikTok/Google trends → demand_score, recompute final_score every 3h
- **Layer 9 — Narrative Engine**: 1 story → 8 channel formats (video + image + text)
- **Layer 10 — Performance Intelligence**: cross-platform attribution, ML predictor, A/B framework

Each is gated by feature flags in `.env`. The system is designed so any layer can fail or be disabled without affecting the others.

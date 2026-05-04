# affiliate-ai

> **Autonomous Shopee affiliate marketing engine** built for the Thai market.
> Scrape → translate → render multilingual SEO site → detect promos → generate
> ads → publish to FB / IG / TikTok → track clicks → learn → repeat.
> One Bun process + one Postgres + Cloudflare Pages — closed loop, no human in
> the daily flow.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun_1.3+-orange.svg)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TS-strict-blue.svg)](https://www.typescriptlang.org/)

---

## What this is

A reference implementation of a fully autonomous affiliate-marketing pipeline that:

1. **Scrapes** Shopee Thailand for trending products (4× per day via Apify residential proxy)
2. **Translates** every product into 4 languages (TH source → EN/ZH/JA via Claude Haiku, ~$0.0016/product)
3. **Builds** a static multilingual SEO site (200 products × 4 langs = 850 pages, sub-second rebuild)
4. **Auto-deploys** to Cloudflare Pages within 5 min of each scrape
5. **Detects** price drops, discount jumps, sold-count surges, and new lows every 30 min
6. **Generates** marketing copy (3 angles × 2 channels) for promo products via Claude
7. **Quality-gates** every variant (toxicity / disclosure / forbidden Thai-law terms)
8. **Auto-publishes** to FB Page, IG Business, TikTok during business hours (rate-limited, anti-bot delays)
9. **Tracks clicks** through a Cloudflare Pages Function → Tunnel → DB → 302 to Shopee
10. **Learns nightly**: deactivates underperforming variants (Wilson lower-bound), rebalances scrape budget per niche based on click data

Everything runs unattended on a single 1-2 GB DigitalOcean Droplet + Cloudflare's free tier.

## Why publish this

There's no end-to-end open-source reference for autonomous affiliate marketing in the Thai market. Every commercial tool is either:

- A **browser extension** (closes the API surface, requires a human to leave Chrome open)
- A **SaaS** that locks you into their model + pricing
- A **fragment** (just a scraper, just a content generator, etc.)

This is the whole pipeline, with all the boring infrastructure that makes it actually work autonomously: schedulers, rate limits, cost caps, source-health monitoring, daily reports, niche budget rebalancing, click attribution, multilingual site builder, etc.

## What you can do with it

- **Run as-is** for Shopee Thailand (point at your domain → fill keys → wait)
- **Fork for another marketplace** — replace `src/scraper/shopee/` with Lazada / Amazon / etc.; the rest of the pipeline is marketplace-agnostic
- **Use individual modules**: the bandit (`src/brain/bandit.ts`), the quality gate (`src/quality/`), the multilingual site builder (`src/web/`), the Pages-Function-via-Tunnel pattern (`functions/go/[shortId].ts`) — all work standalone
- **Study** how ~12k lines of TypeScript replace a $5k/mo SaaS stack on a $12/mo droplet

## Quick start

```bash
# 1. Clone + install
git clone https://github.com/<your-org>/affiliate-ai.git
cd affiliate-ai
bun install

# 2. Configure
cp .env.example .env
chmod 600 .env
$EDITOR .env   # see docs/SETUP.md for what each var means

# 3. Database
sudo bash scripts/setup-postgres.sh
bun run db:push

# 4. Smoke test
bun run scrape:once "your-keyword" 5
bun run build:site

# 5. Production install (systemd)
sudo cp deploy/systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-ai-scheduler affiliate-ai-redirect

# 6. Cloudflare Tunnel for click tracking (one-time)
cloudflared service install <CONNECTOR_TOKEN>

# 7. First deploy
bun run deploy:site
```

Detailed setup walkthrough: [docs/SETUP.md](docs/SETUP.md).

## Documentation map

| If you want to... | Read |
|---|---|
| Understand what the system does + why | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| See every feature with examples | [docs/FEATURES.md](docs/FEATURES.md) |
| Get it running on your own droplet | [docs/SETUP.md](docs/SETUP.md) |
| Understand env vars + API keys needed | [docs/env-setup.md](docs/env-setup.md) |
| Activate marketing channels (FB/IG/TikTok) after onboarding | [docs/ACTIVATION.md](docs/ACTIVATION.md) |
| Read deep production notes (gotchas, costs, risks) | [docs/HANDOFF.md](docs/HANDOFF.md) |
| Contribute | [CONTRIBUTING.md](CONTRIBUTING.md) |
| Report security issues | [SECURITY.md](SECURITY.md) |

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | **Bun 1.3+** | Native TypeScript, fast cold start, single binary |
| Language | **TypeScript** strict | One language across server, scraper, site builder, Cloudflare Functions |
| Database | **Postgres 16** self-host | Localhost = zero latency, $0 marginal cost |
| ORM | **Drizzle** | Type-safe, no codegen, easy migrations |
| LLM | **Anthropic Claude** Haiku 4.5 (bulk) / Sonnet 4.6 (decisions) | Best Thai language, prompt-cache friendly |
| Scraper | **Apify** `xtracto/shopee-scraper` | Verified path through Shopee's bot defenses |
| Web | **Static HTML** generated by Bun | No framework runtime, sub-second rebuilds, infinite CDN scale |
| Edge | **Cloudflare Pages + Functions + Tunnel** | Free CDN + Workers + secure tunnel, all under one CF account |
| Cron | **croner** in-process | One systemd service runs everything (11 jobs) |

## License

[MIT](LICENSE) — use it, fork it, ship it. Attribution appreciated but not required.

## Disclaimer

This is engineering reference code. **You are responsible for compliance**:

- Shopee Affiliate Program **Terms of Service**
- Meta Platform **Terms** (Facebook + Instagram posting policies)
- TikTok **Community Guidelines** + Content Posting API ToS
- Thai consumer protection law (อย. + สคบ.) — the Quality Gate's forbidden-words list is a starting point, not a legal guarantee
- Personal data: this system hashes IP + User-Agent before storing clicks, but check your local law (PDPA / GDPR / equivalent)

The maintainers ship code, not legal advice.

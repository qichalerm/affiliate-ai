# Contributing to affiliate-ai

Thanks for considering a contribution. This project was built fast (30 sprints in 3 days) so the code has rough edges — PRs that improve robustness, docs, or coverage are very welcome.

## Quick orientation

Before sending a PR, read these in order:

1. [README.md](README.md) — what the system does + full architecture (diagrams, module map, data flow, design decisions)
2. [docs/FEATURES.md](docs/FEATURES.md) — per-subsystem feature catalog with examples
3. [docs/SETUP.md](docs/SETUP.md) — how to run locally
4. [docs/HANDOFF.md](docs/HANDOFF.md) — production-state details + critical gotchas

## Local development

```bash
git clone https://github.com/<your-org>/affiliate-ai.git
cd affiliate-ai
bun install
cp .env.example .env
chmod 600 .env
# Fill in the env vars you need (at minimum: DATABASE_URL, ANTHROPIC_API_KEY, APIFY_TOKEN)

# Set up Postgres
sudo bash scripts/setup-postgres.sh
bun run db:push

# Smoke test
bun run scrape:once "หูฟัง" 5
bun run build:site
```

## Code conventions

- **Bun + TypeScript strict** — no JavaScript files
- **Drizzle ORM** for all DB access — no raw SQL except where indicated
- **Zod** for env + LLM output validation
- **Pino** for logging — use `child("module-name")` to scope
- Match existing patterns in `src/` rather than introducing new ones
- Follow the existing comment style: explain *why*, not *what*
- No new top-level dependencies without discussion

## Pull request checklist

- [ ] `bunx tsc --noEmit` passes (no new TS errors)
- [ ] `biome check src/` passes
- [ ] New tables → migration generated via `bun run db:generate` and applied via `bun run db:migrate`
- [ ] New cron job → registered in `src/scheduler/index.ts` with cron expression rationale in description
- [ ] New env var → added to `.env.example` AND validated in `src/lib/env.ts`
- [ ] Touched docs if user-visible behaviour changed
- [ ] Commit messages explain *why*, not *what* (see existing log for style)
- [ ] Did NOT commit `.env`, secrets, or personal references (domain, IP, account ID)

## Commit message style

Single-line title `<60 chars`, prefixed with the area:

```
feat(brain): Sprint 14 — M6 Promo Hunter detection
fix(deploy): bunx not found in systemd $PATH
docs: add ARCHITECTURE.md
audit: 2 fixes — Pages Function HEAD handler + redirect-server localhost-bind
```

Body explains motivation, gotchas, and verification done. Look at recent log for examples.

## What we'd love help with

- 🟢 Tests — there's a `src/scripts/test-*.ts` pattern but coverage is spotty
- 🟢 More scraper sources (Lazada, JD Central, etc.) — TikTok Shop scaffold is at `src/scraper/tiktok-shop/`
- 🟢 Better quality-gate prompts — current `claude-moderator.ts` is a starting point
- 🟢 Backup automation — nightly `pg_dump` to S3/R2 is a TODO
- 🟢 Multi-site support — currently single-tenant; refactor to support multiple `SITE_DOMAIN` per droplet
- 🟢 Fix `rating_count` + `sold_count` parser — Apify output schema doesn't match our parser for these two fields

## Code of conduct

Be kind. This is a small project; tone matters more than rules.

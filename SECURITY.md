# Security Policy

## Reporting a Vulnerability

If you discover a security issue, **do not open a public GitHub issue**. Instead:

1. Open a private security advisory via GitHub:
   `https://github.com/<your-org>/affiliate-ai/security/advisories/new`
2. Or email the maintainer directly with subject `[SECURITY] affiliate-ai`.

We aim to respond within 7 days.

## Scope of Concern

This project handles real production credentials (Cloudflare, Anthropic, Apify, Meta, Shopee Affiliate, etc.). Please report:

- Secrets accidentally committed to git history.
- Vulnerable dependencies (Dependabot alerts).
- Logic flaws that bypass the Quality Gate (e.g. forbidden-words filter).
- Click tracking / redirect server bugs that could be abused for open-redirect attacks.
- Missing input validation in scrapers that could be exploited via crafted Shopee responses.
- Cloudflare Pages Function or Tunnel misconfiguration that exposes the origin.

## Hardening Checklist (operators)

When self-hosting:

- [ ] `.env` permissions are `600` (`chmod 600 .env`)
- [ ] `.env` is in `.gitignore` (it is — never remove)
- [ ] `INTERNAL_AUTH_SECRET` is a fresh `openssl rand -hex 32` per deployment
- [ ] Postgres binds to `localhost` only (default in `setup-postgres.sh`)
- [ ] Redirect-server binds to `127.0.0.1` only — `REDIRECT_SERVER_HOST=127.0.0.1`
- [ ] Cloudflare API token uses **least-privilege scopes** (Pages:Edit, DNS:Edit, Tunnel:Edit only — not full Account:Edit)
- [ ] Meta + TikTok long-lived tokens are rotated on schedule (calendar reminder day 50 of 60)
- [ ] No real values committed to `.env.example` — only template placeholders

## Known Trust Boundaries

| Surface | Threat | Mitigation |
|---|---|---|
| `/go/<shortId>` Pages Function | Open-redirect abuse via crafted shortIds | DB lookup is exact-match; unknown IDs return 404 |
| Droplet redirect-server | Direct hits to public droplet IP | Bound to `127.0.0.1` + shared-secret header check |
| Apify scraper output | Malicious product names with HTML/script | All output is HTML-escaped at render time (templates.ts) |
| LLM-generated variants | Prompt injection, toxicity, regulated claims | 6-layer Quality Gate (claude-moderator + forbidden-words + disclosure) |
| Cloudflare Tunnel | Tunnel token leak | Token never committed; rotate via Zero Trust dashboard if leaked |

## Supply Chain

- Dependencies pinned via `bun.lock` (committed).
- Bun, Postgres, Cloudflare wrangler are the only runtime requirements.
- `bunx wrangler@latest` fetches latest wrangler — pin to a specific version in `deploy-cloudflare.ts` if you need reproducibility across deployments.

# Setup Guide

Get the system running on a fresh Ubuntu 24.04 droplet (1-2 GB RAM minimum).

Total time: **~30 minutes** (excludes API approval waits — Shopee/Meta/TikTok have 1-7 day approvals).

---

## Prerequisites

- A clean Ubuntu 24.04 server (DigitalOcean, Hetzner, Vultr, Linode all work)
- Root SSH access
- A domain you control (registered anywhere — Cloudflare Registrar recommended for cheapest renewal)
- A Cloudflare account (free tier is enough for everything)
- An Anthropic API account ($5 credit to start)
- An Apify account ($5 free credit to start)

---

## Step 1: System packages

```bash
ssh root@<droplet-ip>
apt update && apt upgrade -y
apt install -y postgresql postgresql-contrib git curl ufw
```

---

## Step 2: Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
exec $SHELL   # reload PATH
bun --version  # should print 1.3.x
```

---

## Step 3: Clone + install dependencies

```bash
cd /root
git clone https://github.com/<your-org>/affiliate-ai.git
cd affiliate-ai
bun install
```

---

## Step 4: Postgres setup

```bash
sudo bash scripts/setup-postgres.sh
```

This script:
- Configures Postgres to bind localhost only
- Creates database `affiliate` and user `botuser` with random password
- Grants the schema permissions
- Tunes memory for 1-2 GB droplets
- Outputs the `DATABASE_URL` to add to `.env`

---

## Step 5: Configure `.env`

```bash
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

**Minimum to run:**

```ini
DOMAIN_NAME=your-domain.com
DATABASE_URL=postgresql://botuser:GENERATED_PASSWORD@localhost:5432/affiliate?sslmode=disable

# Anthropic — required (translations + variant gen)
ANTHROPIC_API_KEY=sk-ant-api03-...

# Apify — required (Shopee scraping)
APIFY_TOKEN=apify_api_...

# Cloudflare — required (auto-deploy + tunnel)
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...    # scopes: Pages:Edit + DNS:Edit + Tunnel:Edit
CLOUDFLARE_ZONE_ID=...
CLOUDFLARE_PAGES_PROJECT=affiliate-ai

# Site config
SITE_DOMAIN=your-domain.com
SITE_NAME=Your Site Name

# Generate fresh
INTERNAL_AUTH_SECRET=$(openssl rand -hex 32)
```

Everything else is optional and can stay blank initially. See [env-setup.md](env-setup.md) for the full reference.

---

## Step 6: Apply database schema

```bash
bun run db:push
```

Verifies schema is applied. Use `bun run db:studio` to inspect tables visually.

---

## Step 7: First test

```bash
# Smoke test: scrape 5 products for one keyword
bun run scrape:once "หูฟัง" 5

# Build the static site
bun run build:site

# Should produce dist/ with index.html, /th/, /en/, /zh/, /ja/, etc.
ls -la dist/
```

If both succeed, the core data path works.

---

## Step 8: Create Cloudflare Pages project

You can do this via dashboard OR API:

**Dashboard route:**
1. https://dash.cloudflare.com → Pages → Create a project
2. Direct upload (no Git connection needed) — name: `affiliate-ai`
3. Add custom domain: `your-domain.com` (and `www.your-domain.com` if desired)
4. Note: Cloudflare will set up DNS + SSL automatically if domain is on CF

**Then paste the project name into `.env`:**
```ini
CLOUDFLARE_PAGES_PROJECT=affiliate-ai
```

---

## Step 9: First deploy

```bash
bun run deploy:site
```

Should succeed in ~10-15 seconds. Verify:

```bash
curl -sI https://your-domain.com/th/ | head -3
# Expect: HTTP/2 200
```

---

## Step 10: Cloudflare Tunnel for click tracking

The redirect server runs on the droplet at port 3001 (localhost only). Cloudflare Tunnel reaches it from CF's edge network without exposing any public port.

**Dashboard route:**
1. https://one.dash.cloudflare.com → Networks → Tunnels → Create a tunnel
2. Type: Cloudflared. Name: `affiliate-ai-redirect`
3. After creation, you'll see an "Install connector" command. Copy the **token** (the long string after `--token`)
4. Public Hostnames tab: add `api.your-domain.com` → service: `HTTP` `localhost:3001`

**Install on droplet:**
```bash
# Download cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared
chmod +x /usr/local/bin/cloudflared

# Install + start (paste your token from step 3 above)
cloudflared service install <YOUR_CONNECTOR_TOKEN>

# Verify
systemctl is-active cloudflared
curl -sI https://api.your-domain.com/health  # expect HTTP/2 200
```

---

## Step 11: Cloudflare Pages env vars (for /go/<id> Function)

The Pages Function `/go/<shortId>` needs to know:

- `INTERNAL_AUTH_SECRET` (must match droplet's `.env`)
- `ORIGIN_URL` = `https://api.your-domain.com`

**Set via API:**
```bash
bun -e '
import { config } from "dotenv";
config();
const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_PAGES_PROJECT, INTERNAL_AUTH_SECRET, SITE_DOMAIN } = process.env;
const body = {
  deployment_configs: {
    production: { env_vars: {
      INTERNAL_AUTH_SECRET: { value: INTERNAL_AUTH_SECRET, type: "secret_text" },
      ORIGIN_URL: { value: `https://api.${SITE_DOMAIN}` }
    }},
    preview: { env_vars: {
      INTERNAL_AUTH_SECRET: { value: INTERNAL_AUTH_SECRET, type: "secret_text" },
      ORIGIN_URL: { value: `https://api.${SITE_DOMAIN}` }
    }}
  }
};
const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${CLOUDFLARE_PAGES_PROJECT}`, {
  method: "PATCH",
  headers: { Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
console.log("PATCH:", (await r.json()).success ? "ok" : "FAIL");
process.exit(0);
'
```

Then redeploy so the Function picks up the new env vars:
```bash
bun run deploy:site
```

---

## Step 12: Install systemd services

```bash
sudo cp deploy/systemd/affiliate-ai-redirect.service /etc/systemd/system/
sudo cp deploy/systemd/affiliate-ai-scheduler.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now affiliate-ai-redirect affiliate-ai-scheduler

# Verify both running
for s in affiliate-ai-redirect affiliate-ai-scheduler cloudflared postgresql; do
  printf "%-30s %s\n" "$s" "$(systemctl is-active $s)"
done
# All should print "active"
```

---

## Step 13: Verify end-to-end

```bash
# 1. Click flow
SHORT=$(curl -s "https://your-domain.com/th/" | \
        grep -oE 'href="/th/p/[^"]+"' | head -1 | \
        xargs -I{} curl -s "https://your-domain.com{}" | \
        grep -oE 'href="https://your-domain.com/go/[A-Za-z0-9]+"' | head -1 | \
        sed 's|.*go/||;s|"$||')
curl -sI "https://your-domain.com/go/$SHORT" | grep -E "HTTP|location"
# Expect: HTTP/2 302 + location: https://shopee.co.th/...

# 2. DB has the click logged
psql "$(grep ^DATABASE_URL .env | cut -d= -f2)" -c \
  "SELECT short_id, country_code, clicked_at FROM clicks ORDER BY id DESC LIMIT 5"

# 3. Cron jobs registered
journalctl -u affiliate-ai-scheduler --since "5 min ago" | grep -E "cron|next"
```

If all 3 work, the system is autonomous.

---

## Step 14: Wait for first scheduled scrape

The next `scrapeTrending` run (08/13/19/22 BKK) will:
1. Pick 4 keywords weighted by niche
2. Scrape ~60 products via Apify
3. Translate to EN/ZH/JA
4. Schedule site rebuild → debounce 5 min → auto-deploy
5. Log everything to `scraper_runs` + `generation_runs`

Check progress:
```bash
journalctl -u affiliate-ai-scheduler -f
```

---

## Step 15: Activate marketing channels (optional)

When you're ready to start posting to FB / IG / TikTok, follow [ACTIVATION.md](ACTIVATION.md).

When you're ready to track real Shopee commission, apply for the Open Affiliate API at https://affiliate.shopee.co.th/open_api and follow [ACTIVATION.md §1](ACTIVATION.md#1-shopee-open-affiliate-api-p0--most-important).

---

## Troubleshooting

### Scraper returns 0 items
- Check Apify dashboard for actor run errors
- Verify `APIFY_TOKEN` is correct
- Check `APIFY_DAILY_BUDGET_USD` cap hasn't been hit

### Auto-deploy fails with "bunx: command not found"
- `deploy-cloudflare.ts` should already handle this with absolute path resolution
- If still failing, check `which bunx` returns `/root/.bun/bin/bunx`

### `/go/<id>` returns HTML 200 instead of 302
- Verify Pages Function deployed: latest deploy should mention "Compiled Worker"
- Verify Pages env vars set (Step 11)
- Verify Cloudflare Tunnel running: `curl -sI https://api.your-domain.com/health`

### Translation cron not catching up
- Check Anthropic budget: `psql "$DATABASE_URL" -c "SELECT SUM(cost_usd_micros)/1e6 FROM generation_runs WHERE created_at > CURRENT_DATE"`
- Hit `DAILY_LLM_BUDGET_USD`? Increase or wait until midnight UTC

### Translation gap on `/en/`, `/zh/`, `/ja/`
- Each cron tick translates 20 products. If you scraped 200 new at once, expect ~7 cron ticks (~5 hours) to catch up
- Force one-shot: `bun -e 'import {translateMissingProducts} from "./src/translation/translator.ts"; await translateMissingProducts({limit:500}); process.exit(0)'`

### Site shows old data
- CF Pages cache TTL: HTML has `cache-control: public, max-age=0, must-revalidate` so should be near-realtime
- Force purge via dashboard if needed (Cache → Purge Everything)

More gotchas + cost details: [HANDOFF.md](HANDOFF.md).

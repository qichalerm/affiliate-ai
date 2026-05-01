# Phase 5 Spec — Compound + Scale

> **Goal**: Add second/third niche. Backlink campaign. Multilingual. Make business sellable as asset.
> **Trigger to build**: Phase 4 stable for ≥8 weeks, ≥฿800k/mo revenue, system requires <5 hr/week maintenance.
> **Estimated build effort**: 1 chat session, ~12-15 new files.
> **New monthly cost when running**: +$50/mo per additional niche (~$300+ total).

---

## No new layers — extends existing

Phase 5 doesn't add architecture. It extends Phase 1-4 capabilities to:
- Run multiple niches concurrently
- Multiple languages (Thai + English)
- Build defensible moats (backlinks, exclusive content)
- Prepare exit (sellable asset)

---

## Build order

1. Multi-niche orchestrator (run 2-3 niches in parallel)
2. Backlink tracker + outreach helper
3. Email newsletter automation
4. Multilingual page generation
5. Export tools (for due diligence / sale)

---

## Files to create

### Multi-niche

```
src/intelligence/
├── niche-orchestrator.ts           # round-robin scheduling across niches
├── niche-config.ts                 # per-niche: keywords, AOV, scoring weights
└── niche-isolation.ts              # ensure niches don't compete in DB queries
```

**Schema additions**:
```sql
ALTER TABLE products ADD COLUMN niche VARCHAR(32) NOT NULL DEFAULT 'it_gadget';
ALTER TABLE content_pages ADD COLUMN niche VARCHAR(32) NOT NULL DEFAULT 'it_gadget';
ALTER TABLE published_posts ADD COLUMN niche VARCHAR(32);

CREATE INDEX products_niche_idx ON products (niche);

CREATE TABLE niches (
  id SERIAL PRIMARY KEY,
  slug VARCHAR(32) UNIQUE NOT NULL,
  name_th VARCHAR(128),
  active BOOLEAN DEFAULT true,
  config_json JSONB,                -- keywords, scoring weights, posting freq
  primary_domain VARCHAR(128),      -- can use subdomain per niche
  affiliate_sub_id VARCHAR(64),     -- for revenue attribution
  added_at TIMESTAMPTZ DEFAULT now()
);
```

### Backlinks

```
src/seo/
├── backlink-tracker.ts             # discover new backlinks (Ahrefs/SEMrush API)
├── outreach-template.ts            # generate guest post pitch emails
├── guest-post-tracker.ts           # track placements in DB
└── domain-authority.ts             # cache DA scores
```

**Schema**:
```sql
CREATE TABLE backlinks (
  id SERIAL PRIMARY KEY,
  source_domain VARCHAR(255),
  source_url TEXT,
  target_url TEXT,
  anchor_text VARCHAR(255),
  is_dofollow BOOLEAN,
  domain_authority INTEGER,
  first_seen_at TIMESTAMPTZ,
  last_verified_at TIMESTAMPTZ,
  status VARCHAR(32),               -- live | lost | toxic
  acquired_via VARCHAR(64)          -- guest_post | mention | natural
);
```

### Email newsletter

```
src/email/
├── client.ts                       # Resend API
├── newsletter-builder.ts           # weekly digest generator
├── drip-campaigns.ts               # multi-step sequences
└── unsubscribe.ts                  # compliance
```

**Schema**:
```sql
CREATE TABLE email_subscribers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  niche VARCHAR(32),
  source VARCHAR(64),               -- popup | referral | paid_ad
  consented_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  last_opened_at TIMESTAMPTZ
);

CREATE TABLE email_sends (
  id BIGSERIAL PRIMARY KEY,
  subscriber_id INTEGER REFERENCES email_subscribers(id) ON DELETE CASCADE,
  campaign VARCHAR(128),
  subject VARCHAR(255),
  sent_at TIMESTAMPTZ DEFAULT now(),
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ
);
```

### Multilingual

```
src/i18n/
├── translator.ts                   # Claude translates Thai → EN
├── locale-router.ts                # /en/review/* paths
└── currency-converter.ts           # THB ↔ USD ↔ regional
```

**Astro changes**:
- Add `astro-i18n` integration
- Routes: `/รีวิว/{slug}` (Thai default) and `/en/review/{slug}` (English)
- `hreflang` tags in head

### Export tools

```
src/exports/
├── financial-report.ts             # P&L per month
├── traffic-report.ts               # ga-style metrics export
├── content-inventory.ts            # all pages + perf
├── due-diligence-pack.ts           # full asset package for sale
└── transfer-package.ts             # zip everything for buyer
```

---

## Decisions for Phase 5

### Niche selection (data-driven)

After Phase 4, look at metrics:
```sql
SELECT 
  niche,
  AVG(content_score) AS avg_score,
  SUM(revenue) AS total_revenue,
  AVG(production_cost) AS avg_cost
FROM cohort_analysis_view
WHERE created_at > now() - interval '60 days'
GROUP BY niche;
```

Pick top 1-2 candidate niches based on:
- Potential AOV
- Competition (lower better)
- Content output rate (some niches harder to scale)

### Subdomain vs subdirectory

- **Subdomain per niche**: `gadget.dealfinder.co`, `beauty.dealfinder.co`
  - Pro: clean isolation, easy to sell each separately
  - Con: each subdomain builds DA from zero
- **Subdirectory per niche**: `dealfinder.co/it-gadget/`, `dealfinder.co/beauty/`
  - Pro: shared DA, faster ranking
  - Con: harder to sell pieces

**Recommendation**: subdirectory until selling becomes plan, then split.

### Sell or hold?

Indicators it's time to sell:
- Revenue plateaued ≥3 months
- Competitor with deeper pockets enters
- Burn-out or operator life change
- Buyer offers ≥18x MRR

Indicators to hold:
- Still growing >5%/mo
- ML model getting better
- New niches not yet exhausted
- Tax-efficient via Thai company structure

---

## New env vars

```bash
# Resend (email)
RESEND_API_KEY=
EMAIL_FROM=hello@yourdomain.com

# Niche config
PRIMARY_NICHE=it_gadget
SECONDARY_NICHE=beauty               # added in Phase 5
TERTIARY_NICHE=                      # optional Phase 5+

# i18n
DEFAULT_LOCALE=th
ENABLED_LOCALES=th,en

# Backlinks (optional)
AHREFS_API_TOKEN=
SEMRUSH_API_KEY=

# Exit prep
EXPORT_DESTINATION=                  # S3 path or local
```

---

## Cron additions

```typescript
{ name: "newsletterWeekly",   cron: "0 8 * * 5",    description: "Friday newsletter" },
{ name: "backlinkScanner",    cron: "0 4 * * 1",    description: "Weekly backlink audit" },
{ name: "translatePages",     cron: "0 5 * * *",    description: "Translate new TH pages → EN" },
{ name: "nicheOrchestrator",  cron: "*/15 * * * *", description: "Round-robin niche scheduler" },
```

---

## Validation checklist

- [ ] Second niche live with own products + content pages
- [ ] No SEO regression on primary niche
- [ ] At least 5 quality backlinks acquired
- [ ] Newsletter open rate > 25%
- [ ] English version of top 100 pages live
- [ ] Export package generates without manual intervention
- [ ] Total revenue from secondary niche > ฿100k/mo within 4 months

---

## Risks specific to Phase 5

| Risk | Mitigation |
|---|---|
| Spreading too thin | Cap at 3 niches max; don't scale until each > ฿100k/mo |
| Translation quality | Hire native English editor for top 50 pages; AI for long tail |
| Email spam complaints | Strict double opt-in; clear unsubscribe; SPF/DKIM/DMARC |
| Backlink penalties | Only quality DA40+; avoid PBN networks |
| Sale negotiation collapses | Have minimum acceptable price; don't reveal urgency |

---

## Endgame economics

| Path | Year 3 outcome |
|---|---|
| Hold | ฿3-15M/year recurring, 95% margin |
| Sell at 18x MRR | Lump sum: ฿72M-360M (one-time) |
| Sell + retain affiliate revenue | Hybrid: half lump + recurring |
| License tech to peers | New revenue stream from your stack |

This is what compounds make possible: at ฿2M/month MRR, the asset itself is worth multi-million-dollar US.

---

**Estimated build time**: 1 chat session if focused, 3-4 weeks calendar
**Hardest part**: deciding when to stop optimizing and start selling
**Skip if**: revenue not yet stable at ฿800k+/mo (premature scaling kills phase 1-4 health)

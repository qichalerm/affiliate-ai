# Database

## Schema management

- **`schema.ts`** is the source of truth — all tables defined here
- Migrations are auto-generated via Drizzle Kit

## Workflow

### Development (fast iteration)
```bash
# Edit schema.ts
bun run db:push     # applies schema directly, no migration file
```

### Production (controlled migrations)
```bash
bun run db:generate   # creates new migration in src/db/migrations/
git add src/db/migrations/
git commit -m "schema: add foo table"
# On production server:
bun run db:migrate    # applies pending migrations from disk
```

### Inspect
```bash
bun run db:studio     # GUI at https://local.drizzle.studio
```

## Connection

Connection string lives in `.env` as `DATABASE_URL`.
- Self-hosted Postgres: `postgresql://botuser:PASS@localhost:5432/affiliate?sslmode=disable`
- Neon: `postgresql://user:PASS@ep-xxx.neon.tech/dbname?sslmode=require`

## Backup & restore

```bash
# Backup
sudo /root/research-2/scripts/backup-postgres.sh
# Restore
gunzip -c /var/backups/affiliate/affiliate-YYYYMMDD.sql.gz | psql "$DATABASE_URL"
```

## Tables overview

| Table | Purpose |
|---|---|
| `categories` | Niche taxonomy |
| `shops` | Merchants on each platform |
| `products` | Main product catalog (cross-platform) |
| `product_prices` | Time series of prices |
| `product_reviews` | Scraped review snippets |
| `product_score_history` | Layer 8 scoring snapshots |
| `price_compare` | Cross-platform product matches |
| `affiliate_links` | Tagged URLs with sub-IDs |
| `clicks` | Click events (when /go endpoint live) |
| `conversions` | Sales attributed to our links |
| `content_pages` | Generated review/compare/best-of pages |
| `content_assets` | Images, videos, audio (Phase 3) |
| `published_posts` | Each platform post |
| `trends` | Layer 8 trend signals |
| `campaigns` | Shopee promotional campaigns |
| `keyword_performance` | GSC daily ingestion |
| `page_metrics_daily` | Per-page traffic snapshots |
| `scraper_runs` | Scrape job log |
| `generation_runs` | LLM call log + cost |
| `alerts` | Operator notifications |
| `compliance_logs` | Audit trail for compliance checks |
| `policy_changes` | Tracked TOS updates |
| `scrape_accounts` | Multi-account orchestration (Phase 2) |

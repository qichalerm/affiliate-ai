/**
 * `bun run stats` — comprehensive system stats for operator.
 * Prints to stdout.
 */

import { db, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { allBreakerStatus } from "../lib/circuit-breaker.ts";
import { formatBaht, formatNumber } from "../lib/format.ts";

interface RevenueRow {
  revenue_24h: number;
  conversions_24h: number;
  revenue_7d: number;
  revenue_30d: number;
}

interface CountsRow {
  products: number;
  shopee: number;
  pages_review: number;
  pages_comparison: number;
  pages_bestof: number;
  pages_price_compare: number;
  total_published: number;
}

interface HealthRow {
  scrape_24h_success: number;
  scrape_24h_total: number;
  llm_24h_cost: number;
  alerts_unresolved: number;
}

async function main() {
  const [revenue, counts, health] = await Promise.all([
    db.execute<RevenueRow>(sql`
      SELECT
        COALESCE(SUM(commission_satang) FILTER (WHERE ordered_at > now() - interval '24 hours' AND NOT is_refunded), 0)::bigint AS revenue_24h,
        COUNT(*) FILTER (WHERE ordered_at > now() - interval '24 hours' AND NOT is_refunded)::int AS conversions_24h,
        COALESCE(SUM(commission_satang) FILTER (WHERE ordered_at > now() - interval '7 days' AND NOT is_refunded), 0)::bigint AS revenue_7d,
        COALESCE(SUM(commission_satang) FILTER (WHERE ordered_at > now() - interval '30 days' AND NOT is_refunded), 0)::bigint AS revenue_30d
      FROM conversions
    `),
    db.execute<CountsRow>(sql`
      SELECT
        (SELECT COUNT(*) FROM products WHERE is_active = true)::int AS products,
        (SELECT COUNT(*) FROM products WHERE is_active = true AND platform = 'shopee')::int AS shopee,
        (SELECT COUNT(*) FROM content_pages WHERE status='published' AND type='review')::int AS pages_review,
        (SELECT COUNT(*) FROM content_pages WHERE status='published' AND type='comparison')::int AS pages_comparison,
        (SELECT COUNT(*) FROM content_pages WHERE status='published' AND type='best_of')::int AS pages_bestof,
        (SELECT COUNT(*) FROM content_pages WHERE status='published' AND type='price_compare')::int AS pages_price_compare,
        (SELECT COUNT(*) FROM content_pages WHERE status='published')::int AS total_published
    `),
    db.execute<HealthRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE started_at > now() - interval '24 hours' AND status = 'success')::int AS scrape_24h_success,
        COUNT(*) FILTER (WHERE started_at > now() - interval '24 hours')::int AS scrape_24h_total,
        COALESCE((SELECT SUM(cost_usd) FROM generation_runs WHERE started_at > now() - interval '24 hours'), 0)::float AS llm_24h_cost,
        COALESCE((SELECT COUNT(*) FROM alerts WHERE resolved_at IS NULL), 0)::int AS alerts_unresolved
      FROM scraper_runs
    `),
  ]);

  const r = revenue[0]!;
  const c = counts[0]!;
  const h = health[0]!;

  const lines: string[] = [];
  lines.push("📊 *System Stats*");
  lines.push(`_${new Date().toLocaleString("th-TH")}_`);
  lines.push("");
  lines.push("💰 *Revenue*");
  lines.push(`24h:  ${formatBaht(Number(r.revenue_24h))} (${r.conversions_24h} orders)`);
  lines.push(`7d:   ${formatBaht(Number(r.revenue_7d))}`);
  lines.push(`30d:  ${formatBaht(Number(r.revenue_30d))}`);
  lines.push("");
  lines.push("📦 *Inventory*");
  lines.push(`Products: ${formatNumber(c.products)} (Shopee: ${formatNumber(c.shopee)})`);
  lines.push(`Pages: ${formatNumber(c.total_published)}`);
  lines.push(`  reviews: ${formatNumber(c.pages_review)}`);
  lines.push(`  compare: ${formatNumber(c.pages_comparison)}`);
  lines.push(`  best-of: ${formatNumber(c.pages_bestof)}`);
  lines.push(`  prices:  ${formatNumber(c.pages_price_compare)}`);
  lines.push("");
  lines.push("🔧 *Operations (24h)*");
  const successRate = h.scrape_24h_total > 0 ? (h.scrape_24h_success / h.scrape_24h_total) * 100 : 0;
  lines.push(`Scrape: ${h.scrape_24h_success}/${h.scrape_24h_total} (${successRate.toFixed(0)}%)`);
  lines.push(`LLM:    $${h.llm_24h_cost.toFixed(2)}`);
  lines.push(`Alerts unresolved: ${h.alerts_unresolved}`);
  lines.push("");

  // Circuit breakers
  const breakers = allBreakerStatus();
  if (Object.keys(breakers).length > 0) {
    lines.push("⚡ *Circuit Breakers*");
    for (const [name, state] of Object.entries(breakers)) {
      const icon = state.state === "CLOSED" ? "✓" : state.state === "OPEN" ? "✗" : "?";
      lines.push(`${icon} ${name}: ${state.state} (${state.recentFailures} fails)`);
    }
  }

  console.log(lines.join("\n"));

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

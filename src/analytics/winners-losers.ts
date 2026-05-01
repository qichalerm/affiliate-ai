/**
 * Weekly winners/losers — identifies pages that surged/dropped most.
 *
 * Used by daily report to surface what's working + flag potential issues
 * (sudden traffic drop = possible algorithm penalty, scraper break, etc.)
 */

import { db } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env } from "../lib/env.ts";

interface PerformanceRow {
  page_id: number;
  slug: string;
  type: string;
  title: string;
  impressions_7d: number;
  impressions_prev_7d: number;
  growth_pct: number;
  revenue_30d_satang: number;
  current_score: number | null;
}

export interface WinnersLosers {
  topGainers: PerformanceRow[];
  topLosers: PerformanceRow[];
  newWinners: PerformanceRow[]; // started ranking last 7 days
  topRevenue: PerformanceRow[]; // top revenue earners
}

export async function getWinnersAndLosers(opts: { limit?: number } = {}): Promise<WinnersLosers> {
  const limit = opts.limit ?? 10;

  // Need at least N impressions to be statistically meaningful
  const MIN_IMPRESSIONS = 200;

  const allMovers = await db.execute<PerformanceRow>(sql`
    WITH per_page AS (
      SELECT
        cp.id AS page_id,
        cp.slug,
        cp.type::text AS type,
        cp.title,
        COALESCE(SUM(pm.impressions) FILTER (WHERE pm.captured_date > current_date - 7), 0)::int AS impressions_7d,
        COALESCE(SUM(pm.impressions) FILTER (WHERE pm.captured_date BETWEEN current_date - 14 AND current_date - 7), 0)::int AS impressions_prev_7d,
        cp.revenue_30d_satang::bigint AS revenue_30d_satang,
        (SELECT content_score FROM page_metrics_daily pmd
          WHERE pmd.content_page_id = cp.id
          ORDER BY captured_date DESC LIMIT 1) AS current_score
      FROM content_pages cp
      LEFT JOIN page_metrics_daily pm ON pm.content_page_id = cp.id
      WHERE cp.status = 'published'
      GROUP BY cp.id, cp.slug, cp.type, cp.title, cp.revenue_30d_satang
    )
    SELECT *,
           CASE WHEN impressions_prev_7d > ${MIN_IMPRESSIONS}
                THEN ((impressions_7d::float / impressions_prev_7d) - 1) * 100
                ELSE NULL END AS growth_pct
      FROM per_page
     WHERE impressions_7d > 0 OR impressions_prev_7d > 0
  `);

  const meaningful = allMovers.filter((r) => r.growth_pct !== null);

  const topGainers = meaningful
    .filter((r) => (r.growth_pct ?? 0) > 0 && r.impressions_7d >= MIN_IMPRESSIONS)
    .sort((a, b) => (b.growth_pct ?? 0) - (a.growth_pct ?? 0))
    .slice(0, limit);

  const topLosers = meaningful
    .filter((r) => (r.growth_pct ?? 0) < -20 && r.impressions_prev_7d >= MIN_IMPRESSIONS)
    .sort((a, b) => (a.growth_pct ?? 0) - (b.growth_pct ?? 0))
    .slice(0, limit);

  const newWinners = allMovers
    .filter((r) => r.impressions_prev_7d === 0 && r.impressions_7d > MIN_IMPRESSIONS)
    .sort((a, b) => b.impressions_7d - a.impressions_7d)
    .slice(0, limit);

  const topRevenue = allMovers
    .filter((r) => Number(r.revenue_30d_satang) > 0)
    .sort((a, b) => Number(b.revenue_30d_satang) - Number(a.revenue_30d_satang))
    .slice(0, limit);

  return { topGainers, topLosers, newWinners, topRevenue };
}

export function formatWinnersLosersTelegram(data: WinnersLosers): string {
  const SITE = `https://${env.DOMAIN_NAME}`;
  const lines: string[] = [];
  lines.push("📈 *Weekly Winners & Losers*");
  lines.push("");

  if (data.topGainers.length > 0) {
    lines.push("🚀 *Top Gainers (impressions WoW):*");
    for (const w of data.topGainers.slice(0, 5)) {
      const pct = w.growth_pct?.toFixed(0);
      lines.push(`+${pct}% — ${w.title.slice(0, 50)}`);
    }
    lines.push("");
  }

  if (data.newWinners.length > 0) {
    lines.push("🆕 *Newly Ranking:*");
    for (const w of data.newWinners.slice(0, 5)) {
      lines.push(`${w.impressions_7d.toLocaleString()} impressions — ${w.title.slice(0, 50)}`);
    }
    lines.push("");
  }

  if (data.topLosers.length > 0) {
    lines.push("📉 *Need attention (dropped > 20%):*");
    for (const l of data.topLosers.slice(0, 5)) {
      const pct = l.growth_pct?.toFixed(0);
      lines.push(`${pct}% — ${l.title.slice(0, 50)}`);
    }
    lines.push("");
  }

  if (data.topRevenue.length > 0) {
    lines.push("💰 *Top Revenue (30d):*");
    for (const r of data.topRevenue.slice(0, 5)) {
      const baht = Math.round(Number(r.revenue_30d_satang) / 100).toLocaleString();
      lines.push(`฿${baht} — ${r.title.slice(0, 50)}`);
    }
  }

  return lines.join("\n");
}

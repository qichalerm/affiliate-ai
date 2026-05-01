/**
 * Content performance scoring.
 *
 * Rolls up daily metrics into a 0..100 percentile score per page.
 * Updates content_pages.{impressions_30d, clicks_30d, conversions_30d, revenue_30d_satang}
 * cache fields used for sorting + sitemap priority.
 *
 * Score formula:
 *   score = 0.30 × revenue_percentile
 *         + 0.20 × ctr_percentile         (organic CTR, signal of intent)
 *         + 0.20 × conversion_rate_pct
 *         + 0.15 × impression_growth      (week-over-week)
 *         + 0.15 × engagement             (avg_time_on_page percentile)
 *
 * Pages with no data → score = null (don't show in winners/losers).
 */

import { db, schema } from "../lib/db.ts";
import { sql, eq } from "drizzle-orm";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("analytics.scoring");

interface PageMetrics {
  page_id: number;
  impressions_30d: number;
  organic_clicks_30d: number;
  affiliate_clicks_30d: number;
  conversions_30d: number;
  revenue_satang_30d: number;
  avg_time_on_page: number | null;
  bounce_rate: number | null;
  impressions_7d: number;
  impressions_prev_7d: number;
  ctr_30d: number | null;
}

export async function rollupAndScore(opts: { dryRun?: boolean } = {}): Promise<{
  scored: number;
  zeroData: number;
}> {
  // Aggregate per-page metrics across last 30 days
  const rows = await db.execute<PageMetrics>(sql`
    WITH base AS (
      SELECT
        cp.id AS page_id,
        COALESCE(SUM(pm.impressions) FILTER (WHERE pm.captured_date > current_date - 30), 0)::int AS impressions_30d,
        COALESCE(SUM(pm.organic_clicks) FILTER (WHERE pm.captured_date > current_date - 30), 0)::int AS organic_clicks_30d,
        COALESCE(SUM(pm.affiliate_clicks) FILTER (WHERE pm.captured_date > current_date - 30), 0)::int AS affiliate_clicks_30d,
        COALESCE(SUM(pm.impressions) FILTER (WHERE pm.captured_date > current_date - 7), 0)::int AS impressions_7d,
        COALESCE(SUM(pm.impressions) FILTER (WHERE pm.captured_date BETWEEN current_date - 14 AND current_date - 7), 0)::int AS impressions_prev_7d,
        AVG(pm.avg_time_on_page_sec) FILTER (WHERE pm.captured_date > current_date - 30) AS avg_time_on_page,
        AVG(pm.bounce_rate) FILTER (WHERE pm.captured_date > current_date - 30) AS bounce_rate
      FROM content_pages cp
      LEFT JOIN page_metrics_daily pm ON pm.content_page_id = cp.id
      WHERE cp.status = 'published'
      GROUP BY cp.id
    ),
    conv AS (
      SELECT al.content_page_id AS page_id,
             COUNT(*) FILTER (WHERE NOT c.is_refunded) AS conversions_30d,
             COALESCE(SUM(c.commission_satang) FILTER (WHERE NOT c.is_refunded), 0)::bigint AS revenue_satang_30d
        FROM conversions c
        JOIN affiliate_links al ON al.id = c.affiliate_link_id
       WHERE c.ordered_at > current_date - 30
         AND al.content_page_id IS NOT NULL
       GROUP BY al.content_page_id
    )
    SELECT base.*,
           COALESCE(conv.conversions_30d, 0)::int AS conversions_30d,
           COALESCE(conv.revenue_satang_30d, 0)::bigint AS revenue_satang_30d,
           CASE WHEN base.impressions_30d > 0
                THEN base.organic_clicks_30d::float / base.impressions_30d
                ELSE NULL END AS ctr_30d
      FROM base
      LEFT JOIN conv ON conv.page_id = base.page_id
  `);

  log.info({ pages: rows.length }, "rollup pages");

  // Build percentile baselines
  const ctrs = rows.map((r) => r.ctr_30d).filter((v): v is number => v !== null);
  const dwells = rows.map((r) => r.avg_time_on_page).filter((v): v is number => v !== null);
  const revenues = rows.map((r) => Number(r.revenue_satang_30d)).filter((v) => v > 0);

  const percentile = (sorted: number[], val: number): number => {
    if (sorted.length === 0) return 0.5;
    const i = sorted.findIndex((x) => x >= val);
    return i < 0 ? 1 : i / sorted.length;
  };
  const sortedCtrs = [...ctrs].sort((a, b) => a - b);
  const sortedDwells = [...dwells].sort((a, b) => a - b);
  const sortedRevenues = [...revenues].sort((a, b) => a - b);

  let scored = 0;
  let zeroData = 0;

  for (const r of rows) {
    if (r.impressions_30d === 0 && Number(r.revenue_satang_30d) === 0 && r.affiliate_clicks_30d === 0) {
      zeroData++;
      continue;
    }

    // Component scores 0..1
    const ctrScore = r.ctr_30d != null ? percentile(sortedCtrs, r.ctr_30d) : 0.3;
    const dwellScore =
      r.avg_time_on_page != null ? percentile(sortedDwells, r.avg_time_on_page) : 0.3;
    const revenueScore =
      Number(r.revenue_satang_30d) > 0
        ? percentile(sortedRevenues, Number(r.revenue_satang_30d))
        : 0;

    const cvr =
      r.affiliate_clicks_30d > 0 ? r.conversions_30d / r.affiliate_clicks_30d : 0;
    const cvrScore = Math.min(1, cvr * 25); // 4% CVR = 1.0

    let growth = 0.5;
    if (r.impressions_prev_7d > 0) {
      const ratio = r.impressions_7d / r.impressions_prev_7d;
      growth = Math.min(1, Math.max(0, (ratio - 0.5) / 1.5));
    } else if (r.impressions_7d > 0) {
      growth = 0.8;
    }

    const score =
      (revenueScore * 0.30 +
        ctrScore * 0.20 +
        cvrScore * 0.20 +
        growth * 0.15 +
        dwellScore * 0.15) *
      100;

    if (!opts.dryRun) {
      try {
        await db
          .update(schema.contentPages)
          .set({
            impressions30d: r.impressions_30d,
            clicks30d: r.affiliate_clicks_30d || r.organic_clicks_30d,
            conversions30d: r.conversions_30d,
            revenue30dSatang: Number(r.revenue_satang_30d),
            updatedAt: new Date(),
          })
          .where(eq(schema.contentPages.id, r.page_id));

        // Persist score in latest pageMetricsDaily row for today (or insert)
        await db
          .insert(schema.pageMetricsDaily)
          .values({
            contentPageId: r.page_id,
            capturedDate: new Date(),
            impressions: r.impressions_30d,
            organicClicks: r.organic_clicks_30d,
            affiliateClicks: r.affiliate_clicks_30d,
            avgPosition: null,
            avgTimeOnPageSec: r.avg_time_on_page,
            bounceRate: r.bounce_rate,
            contentScore: score,
          })
          .onConflictDoUpdate({
            target: [schema.pageMetricsDaily.contentPageId, schema.pageMetricsDaily.capturedDate],
            set: {
              contentScore: score,
            },
          });

        scored++;
      } catch (err) {
        log.warn({ pageId: r.page_id, err: errMsg(err) }, "score persist failed");
      }
    } else {
      scored++;
    }
  }

  log.info({ scored, zeroData }, "scoring done");
  return { scored, zeroData };
}

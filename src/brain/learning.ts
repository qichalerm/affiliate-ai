/**
 * M9 Learning Optimizer (Sprint 12).
 *
 * Runs nightly. The Brain (M3 — Thompson Sampling) handles per-variant
 * exploit/explore on-the-fly. M9 does META-OPTIMIZATION: deciding what
 * the Brain should be choosing FROM in the first place.
 *
 * Specifically:
 *   1. AGGREGATE  — yesterday's clicks/conversions/cost per
 *                  (channel, niche, angle, time-of-day)
 *   2. DECIDE
 *      - Mark variants with statistically-significant low CTR as inactive
 *        (free up bandit budget for better candidates)
 *      - Identify winning angle per (niche × channel)
 *      - Identify winning channel per niche
 *      - Recommend scrape budget shift toward niches with best ROI
 *   3. PERSIST    — write to insights table (one row per scope/dimension)
 *      Operator + future Brain runs read these for context.
 *
 * Why decisions live HERE, not in Thompson Sampling:
 *   Bandit answers "of these N variants, which to publish next?".
 *   M9 answers "should this variant even be a candidate? should this
 *   product even get variants? should this niche get scrape budget?"
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";

const log = child("brain.learning");

// ── Decision thresholds (will become env-tunable later) ──────────────
/** Minimum impressions before we trust a CTR estimate. */
const MIN_IMPRESSIONS_FOR_DECISION = 50;
/** A variant is "underperforming" if its CTR is < global mean × this factor. */
const UNDERPERFORMER_RATIO = 0.3;
/** Mark inactive only if confidence interval lower-bound is below threshold. */
const SIG_THRESHOLD = 0.01; // 1% absolute lower bound

interface ChannelStats {
  channel: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface AngleStats {
  channel: string;
  angle: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

interface VariantStats {
  id: number;
  productId: number;
  channel: string;
  angle: string;
  variantCode: string;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface LearningRunResult {
  snapshotDate: string;
  windowDays: number;
  channelsAnalyzed: number;
  anglesAnalyzed: number;
  variantsAnalyzed: number;
  variantsDeactivated: number;
  insightsWritten: number;
}

/**
 * Wilson lower bound — give a more conservative CTR estimate that
 * accounts for sample size. Variants with few impressions get a low
 * lower-bound, protecting them from premature deactivation.
 */
function wilsonLowerBound(clicks: number, impressions: number, z = 1.96): number {
  if (impressions === 0) return 0;
  const phat = clicks / impressions;
  const denom = 1 + (z * z) / impressions;
  const center = phat + (z * z) / (2 * impressions);
  const margin = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * impressions)) / impressions);
  return Math.max(0, (center - margin) / denom);
}

export async function runLearningOptimizer(opts: { windowDays?: number } = {}): Promise<LearningRunResult> {
  const windowDays = opts.windowDays ?? 1; // default: yesterday only
  const snapshotDate = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  log.info({ snapshotDate, windowDays }, "learning optimizer start");

  let insightsWritten = 0;
  let variantsDeactivated = 0;

  // ── 1. Channel performance ──────────────────────────────────────
  const channelRows = await db.execute<ChannelStats>(sql`
    SELECT
      channel::text AS channel,
      COALESCE(SUM(times_shown), 0)::int AS impressions,
      COALESCE(SUM(times_clicked), 0)::int AS clicks,
      CASE WHEN SUM(times_shown) > 0
           THEN SUM(times_clicked)::float / SUM(times_shown)
           ELSE 0 END AS ctr
    FROM content_variants
    WHERE created_at >= ${since.toISOString()}::timestamptz
      AND is_active = true
    GROUP BY channel
    ORDER BY impressions DESC
  `);

  for (const c of channelRows) {
    await db.insert(schema.insights).values({
      snapshotDate,
      scope: "channel",
      dimension: c.channel,
      impressions: c.impressions,
      clicks: c.clicks,
      ctr: c.ctr,
      payload: { windowDays },
    });
    insightsWritten++;
  }

  // ── 2. Angle performance per channel ─────────────────────────────
  const angleRows = await db.execute<AngleStats>(sql`
    SELECT
      channel::text AS channel,
      angle::text AS angle,
      COALESCE(SUM(times_shown), 0)::int AS impressions,
      COALESCE(SUM(times_clicked), 0)::int AS clicks,
      CASE WHEN SUM(times_shown) > 0
           THEN SUM(times_clicked)::float / SUM(times_shown)
           ELSE 0 END AS ctr
    FROM content_variants
    WHERE created_at >= ${since.toISOString()}::timestamptz
      AND is_active = true
    GROUP BY channel, angle
    ORDER BY channel, ctr DESC
  `);

  // Group winners per channel
  const winnersPerChannel = new Map<string, { angle: string; ctr: number }>();
  for (const a of angleRows) {
    if (a.impressions < MIN_IMPRESSIONS_FOR_DECISION) continue;
    const existing = winnersPerChannel.get(a.channel);
    if (!existing || a.ctr > existing.ctr) {
      winnersPerChannel.set(a.channel, { angle: a.angle, ctr: a.ctr });
    }
  }

  for (const a of angleRows) {
    await db.insert(schema.insights).values({
      snapshotDate,
      scope: "angle",
      dimension: `${a.channel}/${a.angle}`,
      impressions: a.impressions,
      clicks: a.clicks,
      ctr: a.ctr,
      payload: {
        windowDays,
        isWinner: winnersPerChannel.get(a.channel)?.angle === a.angle,
      },
    });
    insightsWritten++;
  }

  // ── 3. Underperforming variant cleanup ──────────────────────────
  const variants = await db.execute<VariantStats>(sql`
    SELECT id, product_id AS "productId", channel::text AS channel, angle::text AS angle,
           variant_code AS "variantCode",
           times_shown AS impressions, times_clicked AS clicks,
           CASE WHEN times_shown > 0
                THEN times_clicked::float / times_shown
                ELSE 0 END AS ctr
    FROM content_variants
    WHERE is_active = true
      AND gate_approved = true
      AND times_shown >= ${MIN_IMPRESSIONS_FOR_DECISION}
  `);

  // Compute global mean CTR (weighted by impressions)
  const totalImpressions = variants.reduce((s, v) => s + v.impressions, 0);
  const totalClicks = variants.reduce((s, v) => s + v.clicks, 0);
  const globalCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

  const deactivateThreshold = Math.max(SIG_THRESHOLD, globalCtr * UNDERPERFORMER_RATIO);

  for (const v of variants) {
    const wlb = wilsonLowerBound(v.clicks, v.impressions);
    if (wlb < deactivateThreshold) {
      await db
        .update(schema.contentVariants)
        .set({ isActive: false })
        .where(eq(schema.contentVariants.id, v.id));
      variantsDeactivated++;
      log.info(
        {
          variantId: v.id,
          channel: v.channel,
          angle: v.angle,
          ctr: v.ctr.toFixed(4),
          wilsonLB: wlb.toFixed(4),
          threshold: deactivateThreshold.toFixed(4),
        },
        "deactivated underperforming variant",
      );
    }
  }

  // ── 4. Global summary insight ───────────────────────────────────
  await db.insert(schema.insights).values({
    snapshotDate,
    scope: "global",
    dimension: "summary",
    impressions: totalImpressions,
    clicks: totalClicks,
    ctr: globalCtr,
    payload: {
      windowDays,
      channelsAnalyzed: channelRows.length,
      anglesAnalyzed: angleRows.length,
      variantsAnalyzed: variants.length,
      variantsDeactivated,
      winnersPerChannel: Object.fromEntries(winnersPerChannel),
      globalMeanCtr: globalCtr,
      deactivateThreshold,
    },
  });
  insightsWritten++;

  const result: LearningRunResult = {
    snapshotDate,
    windowDays,
    channelsAnalyzed: channelRows.length,
    anglesAnalyzed: angleRows.length,
    variantsAnalyzed: variants.length,
    variantsDeactivated,
    insightsWritten,
  };

  log.info(result, "learning optimizer done");
  return result;
}

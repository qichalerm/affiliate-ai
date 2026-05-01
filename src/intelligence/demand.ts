/**
 * Demand score — how popular is this product right now?
 *
 * Signals (Phase 1 sources only — extends in Phase 2 with TikTok/Google trends):
 *   - sold_count_30d   (proven recent demand)
 *   - rating_count     (review velocity ~ purchase velocity)
 *   - sold_count_total (long-term popularity)
 *   - view_count       (Shopee internal)
 *   - like_count       (engagement)
 *
 * Returns 0..1 score.
 */

import type { Product } from "../db/schema.ts";

export interface DemandInput {
  product: Pick<
    Product,
    "soldCount" | "soldCount30d" | "ratingCount" | "viewCount" | "likeCount" | "rating"
  >;
}

export interface DemandResult {
  score: number;
  components: {
    velocityScore: number;    // recent sales speed
    proofScore: number;       // total sales proof
    engagementScore: number;  // views + likes
    reviewScore: number;      // rating count
  };
}

/** Log-scale a count to 0..1 using a target plateau. */
function logScale(value: number, plateau: number): number {
  if (value <= 0) return 0;
  const v = Math.log10(value + 1);
  const max = Math.log10(plateau + 1);
  return Math.max(0, Math.min(1, v / max));
}

export function computeDemand(input: DemandInput): DemandResult {
  const p = input.product;

  // Velocity (sold_30d) — best signal of "right now" demand
  const velocityScore = logScale(p.soldCount30d ?? 0, 5_000); // 5k/mo = full score

  // Total sales proof (long-term demand)
  const proofScore = logScale(p.soldCount ?? 0, 50_000);

  // Engagement
  const views = p.viewCount ?? 0;
  const likes = p.likeCount ?? 0;
  const engagementScore = (logScale(views, 100_000) + logScale(likes, 5_000)) / 2;

  // Review proof
  const reviewScore = logScale(p.ratingCount ?? 0, 2_000);

  // Weighted blend (velocity dominant)
  const score =
    velocityScore * 0.45 +
    proofScore * 0.25 +
    engagementScore * 0.15 +
    reviewScore * 0.15;

  return {
    score: Math.max(0, Math.min(1, score)),
    components: { velocityScore, proofScore, engagementScore, reviewScore },
  };
}

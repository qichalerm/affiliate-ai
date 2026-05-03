/**
 * Variant picker — selects which approved variant to publish for a (product × channel).
 *
 * Sprint 5 stub: weighted-random pick using bandit_weight (default 1.0 for all).
 * Sprint 9+ Brain replaces this with proper Thompson Sampling.
 *
 * Why a separate module: every publisher (FB/IG/TikTok/Shopee Video) calls
 * pickVariant() the same way, so when M3 lands the picker upgrade benefits all.
 */

import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import type { Platform } from "../quality/platform-rules.ts";

export interface PickedVariant {
  id: number;
  caption: string;
  hashtags: string[];
  hook: string | null;
  angle: string;
  variantCode: string;
}

/**
 * Pick one approved+active variant for (product × channel).
 *
 * Algorithm v0 (Sprint 5):
 *   1. Filter: gateApproved=true, isActive=true
 *   2. Weighted-random pick by bandit_weight (default = 1.0 → uniform)
 *   3. Return the picked variant
 *
 * Returns null if no eligible variant exists — caller should generate first.
 */
export async function pickVariant(
  productId: number,
  channel: Platform,
): Promise<PickedVariant | null> {
  const candidates = await db.query.contentVariants.findMany({
    where: and(
      eq(schema.contentVariants.productId, productId),
      eq(schema.contentVariants.channel, channel),
      eq(schema.contentVariants.gateApproved, true),
      eq(schema.contentVariants.isActive, true),
    ),
    orderBy: [desc(schema.contentVariants.banditWeight)],
  });

  if (candidates.length === 0) return null;

  // Weighted random — sum weights, pick a point, walk the cumulative
  const totalWeight = candidates.reduce((s, c) => s + c.banditWeight, 0);
  if (totalWeight <= 0) {
    // All zero — pick first
    const c = candidates[0]!;
    return {
      id: c.id,
      caption: c.caption,
      hashtags: c.hashtags ?? [],
      hook: c.hook,
      angle: c.angle,
      variantCode: c.variantCode,
    };
  }

  const target = Math.random() * totalWeight;
  let cumulative = 0;
  for (const c of candidates) {
    cumulative += c.banditWeight;
    if (target <= cumulative) {
      return {
        id: c.id,
        caption: c.caption,
        hashtags: c.hashtags ?? [],
        hook: c.hook,
        angle: c.angle,
        variantCode: c.variantCode,
      };
    }
  }
  // Fallback — should never hit
  const c = candidates[candidates.length - 1]!;
  return {
    id: c.id,
    caption: c.caption,
    hashtags: c.hashtags ?? [],
    hook: c.hook,
    angle: c.angle,
    variantCode: c.variantCode,
  };
}

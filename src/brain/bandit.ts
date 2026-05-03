/**
 * Multi-Armed Bandit — Thompson Sampling (M3 — Sprint 11).
 *
 * For each (product × channel), we have N approved content variants
 * (the "arms"). We need to pick which variant to publish next, balancing
 * EXPLORE (try uncertain variants to learn their conversion rate) vs
 * EXPLOIT (favor variants we already know convert well).
 *
 * Thompson Sampling does this elegantly:
 *   For each variant, model conversion probability as a Beta distribution.
 *   - α (alpha)  = 1 + clicks (successes)
 *   - β (beta)   = 1 + (impressions - clicks) (failures)
 *   - The (1, 1) prior = uniform; cold-start variants get equal chance.
 *
 *   Pick: sample one value from each variant's Beta(α, β), choose the variant
 *   with the highest sample. Variants with high uncertainty get high
 *   variance in their samples → naturally explored. Variants with strong
 *   evidence converge their samples around their true rate → naturally
 *   exploited.
 *
 * No hyperparameter tuning. Self-balancing as data accumulates.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import type { Platform } from "../quality/platform-rules.ts";
import { child } from "../lib/logger.ts";

const log = child("brain.bandit");

/**
 * Sample from Beta(α, β) using the gamma-quotient method.
 *   X ~ Gamma(α, 1)
 *   Y ~ Gamma(β, 1)
 *   Z = X / (X + Y)  ~ Beta(α, β)
 *
 * For α/β as small integers (our typical case: 1-100), Marsaglia-Tsang's
 * method is fast + accurate.
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

/** Marsaglia-Tsang Gamma sampler. Works for shape ≥ 1; for shape < 1 use boost. */
function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Boost trick: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
    const u = Math.random();
    return sampleGamma(shape + 1) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  while (true) {
    let x: number;
    let v: number;
    do {
      x = sampleNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x ** 2 + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Box-Muller standard normal sample. */
function sampleNormal(): number {
  const u1 = Math.random() || 1e-9;
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

export interface BanditPick {
  contentVariantId: number;
  caption: string;
  hashtags: string[];
  hook: string | null;
  angle: string;
  variantCode: string;
  banditScore: number;       // sampled value (for analysis)
  alpha: number;
  beta: number;
}

/**
 * Pick the best variant for (product × channel) via Thompson Sampling.
 * Increments timesShown for the picked variant (so impression count reflects
 * actual exposure — not just whether the variant exists).
 *
 * Returns null if no approved variants exist for this (product × channel).
 */
export async function pickVariantBandit(
  productId: number,
  channel: Platform,
): Promise<BanditPick | null> {
  const candidates = await db.query.contentVariants.findMany({
    where: and(
      eq(schema.contentVariants.productId, productId),
      eq(schema.contentVariants.channel, channel),
      eq(schema.contentVariants.gateApproved, true),
      eq(schema.contentVariants.isActive, true),
    ),
  });

  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    // Single variant — no choice to make, but bump shown counter
    const c = candidates[0]!;
    await bumpTimesShown(c.id);
    return {
      contentVariantId: c.id,
      caption: c.caption,
      hashtags: c.hashtags ?? [],
      hook: c.hook,
      angle: c.angle,
      variantCode: c.variantCode,
      banditScore: 0.5,
      alpha: 1 + c.timesClicked,
      beta: 1 + (c.timesShown - c.timesClicked),
    };
  }

  // Sample from each variant's Beta posterior
  let bestIdx = 0;
  let bestScore = -1;
  let bestAlpha = 0;
  let bestBeta = 0;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const alpha = 1 + c.timesClicked;
    const beta = 1 + Math.max(0, c.timesShown - c.timesClicked);
    const score = sampleBeta(alpha, beta);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
      bestAlpha = alpha;
      bestBeta = beta;
    }
  }

  const picked = candidates[bestIdx]!;
  await bumpTimesShown(picked.id);

  log.debug(
    {
      productId,
      channel,
      pickedId: picked.id,
      pickedAngle: picked.angle,
      score: bestScore.toFixed(4),
      candidates: candidates.length,
    },
    "thompson sampling pick",
  );

  return {
    contentVariantId: picked.id,
    caption: picked.caption,
    hashtags: picked.hashtags ?? [],
    hook: picked.hook,
    angle: picked.angle,
    variantCode: picked.variantCode,
    banditScore: bestScore,
    alpha: bestAlpha,
    beta: bestBeta,
  };
}

async function bumpTimesShown(variantId: number): Promise<void> {
  await db
    .update(schema.contentVariants)
    .set({ timesShown: sql`${schema.contentVariants.timesShown} + 1` })
    .where(eq(schema.contentVariants.id, variantId));
}

/**
 * Bump click counter for a variant (called by click-logger).
 * Increments both timesClicked + bumps the bandit_weight ratio for fast lookup.
 */
export async function bumpVariantClick(variantId: number): Promise<void> {
  await db
    .update(schema.contentVariants)
    .set({
      timesClicked: sql`${schema.contentVariants.timesClicked} + 1`,
      // Update bandit_weight as a denormalized snapshot of current CTR estimate
      // (used by simple weighted-random fallback in case Thompson is disabled).
      banditWeight: sql`(${schema.contentVariants.timesClicked} + 1.0) / GREATEST(${schema.contentVariants.timesShown}, 1)`,
    })
    .where(eq(schema.contentVariants.id, variantId));
}

/**
 * Bump conversion + revenue for a variant (called when affiliate dashboard
 * data lands — Sprint 13+).
 */
export async function bumpVariantConversion(
  variantId: number,
  revenueSatang: number,
): Promise<void> {
  await db
    .update(schema.contentVariants)
    .set({
      timesConverted: sql`${schema.contentVariants.timesConverted} + 1`,
      revenueSatang: sql`${schema.contentVariants.revenueSatang} + ${revenueSatang}`,
    })
    .where(eq(schema.contentVariants.id, variantId));
}

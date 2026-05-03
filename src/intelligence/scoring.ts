/**
 * Combined product scoring (Layer 8).
 *
 * final_score = demand × 0.40 + profitability × 0.40 + seasonality × 0.20
 * Plus: hard kill switches (regulated, low-rating, blacklisted).
 */

import { computeDemand } from "./demand.ts";
import { computeProfitability } from "./profitability.ts";
import { computeSeasonality } from "./seasonality.ts";
import type { Product, Shop } from "../db/schema.ts";

export interface ScoreInput {
  product: Product;
  shop?: Shop | null;
  today?: Date;
}

export interface ScoreResult {
  finalScore: number;
  demandScore: number;
  profitabilityScore: number;
  seasonalityBoost: number;
  netPerVisit: number;
  estimatedCvr: number;
  effectiveCommission: number;
  killReasons: string[];
  notes: string[];
}

/** Hard floors — products failing these get score=0 regardless. */
function hardKill(p: Product): string[] {
  const reasons: string[] = [];
  if (p.flagBlacklisted) reasons.push("blacklisted");
  if (p.flagRegulated) reasons.push("regulated");
  if ((p.rating ?? 0) > 0 && (p.rating ?? 0) < 3.8 && (p.ratingCount ?? 0) >= 30) {
    reasons.push("low-rating");
  }
  // Apify basic mode often returns sold_count=0 and rating_count=0 even for legit
  // products with a real rating (e.g. 4.5★). Only kill when the product has NO
  // signal at all — no sales, no review count, AND no rating value.
  if (
    (p.soldCount ?? 0) === 0 &&
    (p.ratingCount ?? 0) === 0 &&
    (p.rating ?? 0) === 0
  ) {
    reasons.push("no-traction");
  }
  if (p.currentPrice == null || p.currentPrice <= 0) reasons.push("no-price");
  if (!p.isActive) reasons.push("inactive");
  return reasons;
}

export function scoreProduct(input: ScoreInput): ScoreResult {
  const { product, shop, today } = input;

  const killReasons = hardKill(product);
  if (killReasons.length > 0) {
    return {
      finalScore: 0,
      demandScore: 0,
      profitabilityScore: 0,
      seasonalityBoost: 0,
      netPerVisit: 0,
      estimatedCvr: 0,
      effectiveCommission: 0,
      killReasons,
      notes: [],
    };
  }

  const demand = computeDemand({ product });
  const profit = computeProfitability({ product, shop });
  const season = computeSeasonality({
    categoryId: product.categoryId,
    productName: product.name,
    today,
  });

  const finalScore =
    (demand.score * 0.40 + profit.score * 0.40) * season.boost + 0.0;

  return {
    finalScore: Math.max(0, Math.min(2, finalScore)), // can exceed 1 due to seasonality
    demandScore: demand.score,
    profitabilityScore: profit.score,
    seasonalityBoost: season.boost,
    netPerVisit: profit.netPerVisit,
    estimatedCvr: profit.estimatedCvr,
    effectiveCommission: profit.effectiveCommission,
    killReasons: [],
    notes: [...profit.notes, ...season.reasons],
  };
}

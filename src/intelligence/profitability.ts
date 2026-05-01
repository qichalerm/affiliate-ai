/**
 * Profitability score — estimated revenue per visitor for a product.
 *
 * Formula:
 *   net_per_visit = AOV × CVR × commission_rate × (1 - refund_rate) × indirect_multiplier
 *
 * Inputs available from the products table; missing values fall back to category averages.
 */

import type { Product, Shop } from "../db/schema.ts";
import { bahtFromSatang } from "../lib/format.ts";

export interface ProfitabilityInput {
  product: Pick<
    Product,
    | "currentPrice"
    | "rating"
    | "ratingCount"
    | "soldCount"
    | "soldCount30d"
    | "baseCommissionRate"
    | "xtraCommissionRate"
    | "hasFreeShipping"
    | "hasVoucher"
    | "stock"
  >;
  shop?: Pick<Shop, "isMall" | "isPreferred" | "rating" | "reliabilityScore"> | null;
}

const INDIRECT_MULTIPLIER = 1.3; // ลูกค้าซื้อสินค้าอื่นในร้านด้วย

const ESTIMATED_REFUND_RATE = 0.08; // 8% baseline TH

const DEFAULT_COMMISSION = 0.04; // 4% blended fallback

export interface ProfitabilityResult {
  /** Estimated net revenue per visitor (in baht). Higher = better. */
  netPerVisit: number;
  /** Estimated CVR (0..1) for this product. */
  estimatedCvr: number;
  /** Effective commission rate used (0..1). */
  effectiveCommission: number;
  /** Score 0..1 normalized for ranking. */
  score: number;
  notes: string[];
}

export function computeProfitability(input: ProfitabilityInput): ProfitabilityResult {
  const { product, shop } = input;
  const notes: string[] = [];

  const aovBaht = bahtFromSatang(product.currentPrice ?? 0);
  if (aovBaht <= 0) {
    return {
      netPerVisit: 0,
      estimatedCvr: 0,
      effectiveCommission: 0,
      score: 0,
      notes: ["no-price"],
    };
  }

  // Commission
  const base = product.baseCommissionRate ?? DEFAULT_COMMISSION;
  const xtra = product.xtraCommissionRate ?? 0;
  const effectiveCommission = base + xtra;

  // CVR estimate based on quality signals
  let cvr = 0.025; // baseline 2.5%

  if (product.rating != null) {
    if (product.rating >= 4.7) cvr += 0.008;
    else if (product.rating >= 4.5) cvr += 0.005;
    else if (product.rating >= 4.0) cvr += 0.002;
    else cvr -= 0.005;
  }

  if (product.soldCount != null) {
    if (product.soldCount >= 5000) cvr += 0.005; // social proof
    else if (product.soldCount >= 1000) cvr += 0.003;
    else if (product.soldCount >= 100) cvr += 0.001;
  }

  if (shop?.isMall) cvr += 0.003;
  else if (shop?.isPreferred) cvr += 0.002;

  if (product.hasFreeShipping) cvr += 0.002;
  if (product.hasVoucher) cvr += 0.001;

  // Stock check — out of stock = no conversions
  if (product.stock != null && product.stock < 5) {
    cvr *= 0.3;
    notes.push("low-stock");
  }

  // Shop reliability adjustment
  if (shop?.reliabilityScore != null) {
    cvr *= 0.8 + shop.reliabilityScore * 0.4; // 0.8x to 1.2x
  }

  cvr = Math.max(0.001, Math.min(0.08, cvr));

  // Net per visit
  const netPerVisit =
    aovBaht * cvr * effectiveCommission * (1 - ESTIMATED_REFUND_RATE) * INDIRECT_MULTIPLIER;

  // Normalize to 0..1 score (log-scaled — best product earns ~10 baht/visit)
  // log10(10) = 1, log10(1) = 0, log10(0.1) = -1 → normalize via sigmoid
  const score = 1 / (1 + Math.exp(-(Math.log10(Math.max(0.01, netPerVisit)) + 1) * 1.5));

  return {
    netPerVisit,
    estimatedCvr: cvr,
    effectiveCommission,
    score,
    notes,
  };
}

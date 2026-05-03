/**
 * TikTok Shop product types — Sprint 26.
 * Mirrors src/scraper/shopee/types.ts shape so persist logic can reuse
 * the same upsert pattern (just write platform="tiktok_shop" instead).
 */

import { schema } from "../../lib/db.ts";

export type Niche = (typeof schema.nicheEnum.enumValues)[number];

export interface TikTokShopProduct {
  /** Stable platform-side id (numeric or string). */
  externalId: string;
  /** Shop-side id (for building affiliate URL). */
  shopExternalId: string | null;
  shopName: string | null;

  name: string;
  brand?: string | null;
  description?: string | null;

  primaryImage: string | null;
  imageUrls?: string[];

  currentPriceSatang: number;          // converted from BAHT × 100
  originalPriceSatang?: number | null;
  discountPercent?: number | null;     // 0..1 fraction

  rating?: number | null;
  ratingCount?: number | null;
  soldCount?: number | null;
  soldCount30d?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;

  raw: unknown;
}

export interface ApifyTikTokRunStats {
  apifyRunId: string;
  costUsd: number;
  durationMs: number;
}

export interface ApifyTikTokSearchResult {
  products: TikTokShopProduct[];
  stats: ApifyTikTokRunStats;
}

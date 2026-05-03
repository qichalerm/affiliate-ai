/**
 * Internal product/shop shape produced by the Shopee parser.
 * Independent of Apify's raw schema so swapping scraper later doesn't
 * touch persist.ts or downstream consumers.
 */

import type { schema } from "../../lib/db.ts";

export type Niche = (typeof schema.nicheEnum.enumValues)[number];

export interface ShopeeShop {
  externalId: string;
  name: string;
  isMall: boolean;
  isPreferred: boolean;
  rating?: number | null;
  ratingCount?: number | null;
  followerCount?: number | null;
  productCount?: number | null;
  responseRate?: number | null;
  responseTimeHours?: number | null;
  shipFromLocation?: string | null;
  createdSinceDays?: number | null;
  raw?: Record<string, unknown>;
}

export interface ShopeeProduct {
  externalId: string;        // shopee item id
  shopExternalId: string;    // shopee shop id (for URL building)
  niche?: Niche;             // assigned by keyword → niche mapping
  name: string;
  brand?: string | null;
  description?: string | null;

  // Media
  primaryImage?: string | null;
  imageUrls?: string[];

  // Price (in satang — int)
  currentPriceSatang: number;
  originalPriceSatang?: number | null;
  discountPercent?: number | null;  // 0..1

  // Demand signals (Apify often returns 0 for these — handle nullably)
  rating?: number | null;
  ratingCount?: number | null;
  soldCount?: number | null;
  soldCount30d?: number | null;
  viewCount?: number | null;
  likeCount?: number | null;

  raw?: Record<string, unknown>;
}

export interface ApifyShopeeRunStats {
  costUsd: number;
  durationMs: number;
  itemCount: number;
  apifyRunId: string;
}

export interface ApifySearchResult {
  products: ShopeeProduct[];
  shopsByExternalId: Map<string, ShopeeShop>;
  stats: ApifyShopeeRunStats;
}

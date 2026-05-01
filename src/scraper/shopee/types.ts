/**
 * Type contracts for Shopee data.
 * Internal normalized types — separate from raw API shapes.
 */

export interface ShopeeProduct {
  externalId: string;
  shopExternalId: string;
  categoryId?: number;
  name: string;
  brand?: string;
  model?: string;
  description?: string;
  primaryImage?: string;
  imageUrls: string[];
  currentPriceSatang: number;
  originalPriceSatang?: number;
  discountPercent?: number;
  stock?: number;
  rating?: number;
  ratingCount?: number;
  soldCount?: number;
  soldCount30d?: number;
  viewCount?: number;
  likeCount?: number;
  hasFreeShipping: boolean;
  hasVoucher: boolean;
  variants?: ShopeeVariant[];
  specifications?: Record<string, string>;
  raw: unknown;
}

export interface ShopeeVariant {
  optionName: string;
  optionValue: string;
  priceSatang?: number;
  stock?: number;
}

export interface ShopeeShop {
  externalId: string;
  name: string;
  isMall: boolean;
  isPreferred: boolean;
  rating?: number;
  ratingCount?: number;
  followerCount?: number;
  productCount?: number;
  responseRate?: number;
  responseTimeHours?: number;
  shipFromLocation?: string;
  createdSinceDays?: number;
  raw?: unknown;
}

export interface ShopeeReview {
  externalId: string;
  rating: number;
  body: string;
  reviewerName: string;
  isVerified: boolean;
  helpfulCount: number;
  capturedAt: Date;
}

export interface ShopeeSearchResult {
  total: number;
  items: ShopeeProduct[];
  shops: Map<string, ShopeeShop>;
}

export interface ScrapeOptions {
  /** Max items per request (Shopee allows up to 60). */
  limit?: number;
  /** Pagination offset. */
  offset?: number;
  /** Sort: 1=Relevance, 2=Latest, 5=Top sales, 12=Price asc, 13=Price desc, 18=Rating */
  orderBy?: number;
  /** Restrict to Mall shops. */
  mallOnly?: boolean;
  /** Override request timeout. */
  timeoutMs?: number;
}

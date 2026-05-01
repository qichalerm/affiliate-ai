/**
 * Normalized internal types for Lazada products.
 * Keep parallel to scraper/shopee/types.ts so cross-platform code can share interfaces.
 */

export interface LazadaProduct {
  externalId: string;            // Lazada nid (item id)
  shopExternalId: string;        // Lazada seller id
  categoryId?: number;
  name: string;
  brand?: string;
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
  hasFreeShipping: boolean;
  isLazMall: boolean;
  specifications?: Record<string, string>;
  raw: unknown;
}

export interface LazadaShop {
  externalId: string;
  name: string;
  isLazMall: boolean;
  rating?: number;
  followerCount?: number;
  shipFromLocation?: string;
  raw?: unknown;
}

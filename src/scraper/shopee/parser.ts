/**
 * Apify Shopee response parser.
 *
 * Actor: xtracto/shopee-scraper (verified 2026-05-03)
 *
 * Returned fields (search mode):
 *   item_id, shop_id, name, url, image_url, price (BAHT),
 *   original_price (BAHT), discount_pct (0-100), rating, rating_count,
 *   sold_count, location, is_mall, currency
 *
 * Notes:
 *   - Price comes in BAHT — we convert to SATANG (×100) for DB storage.
 *   - sold_count + rating_count often null even for legit products
 *     (Apify limitation) — handle nullably; M2 uses OR-fallback for scoring.
 *   - Strings may contain NUL bytes (\x00) — sanitizeForPostgres strips them.
 */

import type { ShopeeProduct, ShopeeShop } from "./types.ts";

interface ApifyShopeeItem {
  item_id?: number | string;
  shop_id?: number | string;
  name?: string;
  url?: string;
  image_url?: string;
  price?: number;            // BAHT (will convert to satang)
  original_price?: number | null;
  discount_pct?: number | null;  // 0-100
  rating?: number | null;
  rating_count?: number | null;
  sold_count?: number | null;
  location?: string | null;
  is_mall?: boolean;
  currency?: string;
  // Legacy fields kept for fallback (different actor versions)
  brand?: string;
  description?: string;
  shop_name?: string;
}

function asString(v: unknown): string | undefined {
  if (v == null) return undefined;
  return String(v).trim() || undefined;
}

function asNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Strip NUL bytes (\x00) recursively from any string in an object.
 * Postgres TEXT columns reject these.
 */
export function sanitizeForPostgres<T>(input: T): T {
  if (input == null) return input;
  if (typeof input === "string") return input.replace(/\x00/g, "") as T;
  if (Array.isArray(input)) return input.map((v) => sanitizeForPostgres(v)) as T;
  if (typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = sanitizeForPostgres(v);
    }
    return out as T;
  }
  return input;
}

export interface ParsedItem {
  product: ShopeeProduct;
  shop?: ShopeeShop;
}

/**
 * Convert raw Apify item → internal ShopeeProduct + ShopeeShop.
 * Returns null if essential fields (item_id, shop_id, name, price) missing.
 */
export function parseApifyShopeeItem(raw: ApifyShopeeItem): ParsedItem | null {
  const itemId = asString(raw.item_id);
  const shopId = asString(raw.shop_id);
  const name = asString(raw.name);
  const priceBaht = asNumber(raw.price);

  if (!itemId || !shopId || !name || priceBaht == null) return null;

  // Price: BAHT → SATANG
  const currentPriceSatang = Math.round(priceBaht * 100);
  const originalPriceSatang =
    raw.original_price != null ? Math.round(asNumber(raw.original_price)! * 100) : undefined;

  // Discount %: actor returns 0-100, normalize to 0-1
  let discountPercent: number | undefined;
  if (raw.discount_pct != null) {
    const n = Number(raw.discount_pct);
    discountPercent = n > 1 ? n / 100 : n;
  } else if (originalPriceSatang && originalPriceSatang > currentPriceSatang) {
    discountPercent = (originalPriceSatang - currentPriceSatang) / originalPriceSatang;
  }

  // Build images array (we only get one in search mode)
  const images: string[] = [];
  if (raw.image_url) images.push(raw.image_url);

  const product: ShopeeProduct = {
    externalId: itemId,
    shopExternalId: shopId,
    name,
    brand: asString(raw.brand),
    description: asString(raw.description),
    primaryImage: images[0],
    imageUrls: images,
    currentPriceSatang,
    originalPriceSatang,
    discountPercent,
    rating: asNumber(raw.rating),
    ratingCount: asNumber(raw.rating_count),
    soldCount: asNumber(raw.sold_count),
    raw: raw as Record<string, unknown>,
  };

  // Build shop record from whatever fields exist (search mode often gives nothing)
  const shop: ShopeeShop = {
    externalId: shopId,
    name: asString(raw.shop_name) ?? `Shop ${shopId}`,
    isMall: Boolean(raw.is_mall),
    isPreferred: false,  // not in search-mode response
    shipFromLocation: asString(raw.location),
    raw: { source: "search_mode" } as Record<string, unknown>,
  };

  return { product, shop };
}

/**
 * Convert raw Lazada catalog responses into normalized internal types.
 */

import type { LazadaProduct, LazadaShop } from "./types.ts";
import type { RawListItem } from "./client.ts";

const RE_THB = /[฿,\s]/g;

function parsePriceToBaht(price: string | undefined): number {
  if (!price) return 0;
  const cleaned = price.replace(RE_THB, "");
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function parseSold(text: string | undefined): number | undefined {
  if (!text) return undefined;
  // "Sold 1,234" or "1.2k sold"
  const m = text.match(/([\d.,]+)\s*([kKmM]?)/);
  if (!m) return undefined;
  const num = Number.parseFloat(m[1]!.replace(/,/g, ""));
  if (!Number.isFinite(num)) return undefined;
  const suffix = m[2]?.toLowerCase();
  if (suffix === "k") return Math.round(num * 1000);
  if (suffix === "m") return Math.round(num * 1_000_000);
  return Math.round(num);
}

function parseDiscountPercent(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.match(/-?(\d+)%/);
  if (!m) return undefined;
  return Number.parseInt(m[1]!, 10) / 100;
}

export function parseListItem(item: RawListItem): LazadaProduct {
  const currentBaht = parsePriceToBaht(item.priceShow ?? item.price);
  const originalBaht = parsePriceToBaht(item.originalPriceShow ?? item.originalPrice);

  const images = [
    item.image,
    ...(item.thumbs ?? []).map((t) => t.image),
  ].filter(Boolean) as string[];

  return {
    externalId: String(item.nid ?? item.itemId),
    shopExternalId: String(item.sellerId),
    categoryId: item.categoryId,
    name: item.name,
    brand: item.brandName || undefined,
    primaryImage: item.image,
    imageUrls: images,
    currentPriceSatang: Math.round(currentBaht * 100),
    originalPriceSatang: originalBaht > 0 ? Math.round(originalBaht * 100) : undefined,
    discountPercent: parseDiscountPercent(item.discount),
    rating: item.ratingScore ? Number.parseFloat(item.ratingScore) : undefined,
    ratingCount: item.review,
    soldCount: parseSold(item.itemSoldCntShow),
    hasFreeShipping: Boolean(item.freeShippingDescription),
    isLazMall: Boolean(item.isLazMall),
    raw: item,
  };
}

export function parseShopFromItem(item: RawListItem): LazadaShop {
  return {
    externalId: String(item.sellerId),
    name: item.sellerName ?? `Seller ${item.sellerId}`,
    isLazMall: Boolean(item.isLazMall),
    shipFromLocation: item.location,
    raw: item,
  };
}

/**
 * Convert raw Shopee API responses into normalized internal types.
 */

import type {
  ShopeeProduct,
  ShopeeShop,
  ShopeeReview,
} from "./types.ts";
import type {
  RawItemBasic,
  RawItemDetail,
  RawShopDetail,
  RawRatingResponse,
} from "./client.ts";

/** Shopee returns prices as integer × 100,000 (micro). Convert to satang (× 100). */
function microToSatang(micro: number): number {
  return Math.round(micro / 1000); // 100000 / 100 = 1000
}

const SHOPEE_IMG_BASE = "https://down-th.img.susercontent.com/file/";

function imageUrl(hash: string | undefined): string | undefined {
  if (!hash) return undefined;
  if (hash.startsWith("http")) return hash;
  return `${SHOPEE_IMG_BASE}${hash}`;
}

export function parseItemBasic(item: RawItemBasic): ShopeeProduct {
  const currentSatang = microToSatang(item.price);
  const originalSatang = item.price_before_discount
    ? microToSatang(item.price_before_discount)
    : undefined;

  let discountPercent: number | undefined;
  if (item.raw_discount && item.raw_discount > 0) {
    discountPercent = item.raw_discount / 100;
  } else if (originalSatang && originalSatang > currentSatang) {
    discountPercent = (originalSatang - currentSatang) / originalSatang;
  }

  return {
    externalId: String(item.itemid),
    shopExternalId: String(item.shopid),
    categoryId: item.catid,
    name: item.name,
    brand: item.brand || undefined,
    primaryImage: imageUrl(item.image),
    imageUrls: (item.images ?? []).map((h) => imageUrl(h)).filter((u): u is string => !!u),
    currentPriceSatang: currentSatang,
    originalPriceSatang: originalSatang,
    discountPercent,
    stock: item.stock,
    rating: item.item_rating?.rating_star
      ? Math.round(item.item_rating.rating_star * 10) / 10
      : undefined,
    ratingCount: item.item_rating?.rating_count?.[0],
    soldCount: item.historical_sold ?? item.sold,
    soldCount30d: item.sold,
    viewCount: item.view_count,
    likeCount: item.liked_count,
    hasFreeShipping: Boolean(item.show_free_shipping),
    hasVoucher: Boolean(item.voucher_info),
    raw: item,
  };
}

export function parseItemDetail(detail: RawItemDetail): ShopeeProduct {
  const item = detail.data.item;
  const base = parseItemBasic(item);

  const specs: Record<string, string> = {};
  for (const attr of item.attributes ?? []) {
    if (attr.name && attr.value) specs[attr.name] = attr.value;
  }

  return {
    ...base,
    description: item.description?.slice(0, 6000),
    specifications: Object.keys(specs).length ? specs : undefined,
    variants: item.models?.map((m) => ({
      optionName: "variant",
      optionValue: m.name,
      priceSatang: microToSatang(m.price),
      stock: m.stock,
    })),
  };
}

export function parseShop(detail: RawShopDetail): ShopeeShop {
  const d = detail.data;
  const totalRatings = d.rating_good + d.rating_bad + d.rating_normal;
  const goodRatio = totalRatings > 0 ? d.rating_good / totalRatings : undefined;
  return {
    externalId: String(d.shopid),
    name: d.name,
    isMall: Boolean(d.is_official_shop),
    isPreferred: Boolean(d.is_shopee_verified),
    rating: d.rating_star,
    ratingCount: totalRatings,
    followerCount: d.follower_count,
    productCount: d.item_count,
    responseRate: d.response_rate ? d.response_rate / 100 : undefined,
    responseTimeHours: d.response_time ? d.response_time / 3600 : undefined,
    shipFromLocation: d.place,
    createdSinceDays: d.ctime
      ? Math.floor((Date.now() / 1000 - d.ctime) / 86400)
      : undefined,
    raw: { goodRatio, ...d },
  };
}

const RE_NAME = /[a-zA-Z]/;

/**
 * Mask reviewer name for privacy: "Som*** N." style.
 */
function maskName(name: string): string {
  if (!name) return "ผู้ใช้";
  if (RE_NAME.test(name)) {
    if (name.length <= 2) return `${name[0]}***`;
    return `${name.slice(0, 2)}*** ${name.slice(-1)}.`;
  }
  // Thai name: keep first 2 chars
  return `${name.slice(0, 2)}***`;
}

export function parseReviews(resp: RawRatingResponse): ShopeeReview[] {
  return (resp.data.ratings ?? [])
    .filter((r) => r.comment && r.comment.length >= 30)
    .map((r) => ({
      externalId: String(r.cmtid),
      rating: r.rating_star,
      body: r.comment.trim().slice(0, 2000),
      reviewerName: maskName(r.author_username),
      isVerified: true,
      helpfulCount: 0,
      capturedAt: new Date(r.mtime * 1000),
    }));
}

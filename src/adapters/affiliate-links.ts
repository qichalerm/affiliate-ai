/**
 * Per-platform affiliate URL builder.
 *
 * V2 scope: Shopee + TikTok Shop only.
 * Adding a new platform:
 *   1. Add entry to PLATFORM_BUILDERS
 *   2. Add platform to schema enum
 *   3. (optional) build src/scraper/{platform}/
 */

import { env } from "../lib/env.ts";

export type Platform = "shopee" | "tiktok_shop";

export interface AffiliateUrlInput {
  platform: Platform;
  /** Marketplace product/item ID (string form). */
  externalId: string;
  /** Marketplace shop ID (where applicable; may be undefined). */
  shopExternalId?: string | null;
  /** Sub-tracking ID for attribution. */
  subId: string;
}

/**
 * Build the user-clickable affiliate URL.
 * Returns null if the platform's required IDs are missing.
 */
export function buildAffiliateUrl(input: AffiliateUrlInput): string | null {
  const builder = PLATFORM_BUILDERS[input.platform];
  if (!builder) return null;
  return builder(input);
}

const PLATFORM_BUILDERS: Record<Platform, (input: AffiliateUrlInput) => string | null> = {
  shopee: ({ shopExternalId, externalId, subId }) => {
    if (!shopExternalId) return null;
    const params = new URLSearchParams();
    params.set("af_sub1", subId);
    if (env.SHOPEE_AFFILIATE_ID) params.set("affiliate_id", env.SHOPEE_AFFILIATE_ID);
    if (env.SHOPEE_TRACKING_ID) params.set("af_sub_pub", env.SHOPEE_TRACKING_ID);
    return `https://shopee.co.th/product/${shopExternalId}/${externalId}?${params}`;
  },

  tiktok_shop: ({ externalId, subId }) => {
    // TikTok Shop affiliate format
    if (!env.TIKTOK_SHOP_AFFILIATE_ID) return null;
    return `https://shop.tiktok.com/view/product/${externalId}?utm_source=affiliate&utm_medium=${env.TIKTOK_SHOP_AFFILIATE_ID}&utm_campaign=${subId}`;
  },
};

/** Display name for UI. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

/** Brand color (used for UI accents). */
export const PLATFORM_COLORS: Record<Platform, string> = {
  shopee: "#ee4d2d",
  tiktok_shop: "#000000",
};

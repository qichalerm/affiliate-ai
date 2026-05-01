/**
 * Per-platform affiliate URL builder.
 *
 * Light abstraction — covers only URL building (the part that varies per platform).
 * Full scraping logic lives in src/scraper/{shopee,lazada}/ as before.
 *
 * Adding a new platform:
 *   1. Add entry to PLATFORM_BUILDERS
 *   2. Add platform to schema enum
 *   3. (optional) build src/scraper/{platform}/
 */

import { env } from "../lib/env.ts";

export type Platform = "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";

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

  lazada: ({ externalId, subId }) => {
    // Lazada Affiliate URL format (TH):
    //   https://www.lazada.co.th/products/-i{itemId}.html?wh_pid=...
    // With affiliate redirect via lazada.go2cloud.org or direct ?aff_short_key=
    const params = new URLSearchParams();
    if (env.LAZADA_AFFILIATE_ID) params.set("aff_short_key", env.LAZADA_AFFILIATE_ID);
    params.set("sub_aff_id", subId);
    return `https://www.lazada.co.th/products/-i${externalId}.html?${params}`;
  },

  tiktok_shop: ({ externalId, subId }) => {
    // TikTok Shop affiliate format
    if (!env.TIKTOK_SHOP_AFFILIATE_ID) return null;
    return `https://shop.tiktok.com/view/product/${externalId}?utm_source=affiliate&utm_medium=${env.TIKTOK_SHOP_AFFILIATE_ID}&utm_campaign=${subId}`;
  },

  jd_central: ({ externalId, subId }) => {
    // JD Central wound down in TH 2023 — placeholder
    return `https://www.jd.co.th/product/${externalId}?ref=${subId}`;
  },

  robinson: ({ externalId, subId }) => {
    return `https://www.robinson.co.th/product/${externalId}?ref=${subId}`;
  },
};

/** Display name for UI. */
export const PLATFORM_LABELS: Record<Platform, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok_shop: "TikTok Shop",
  jd_central: "JD Central",
  robinson: "Robinson Online",
};

/** Brand color (used for UI accents). */
export const PLATFORM_COLORS: Record<Platform, string> = {
  shopee: "#ee4d2d",
  lazada: "#0f146b",
  tiktok_shop: "#000000",
  jd_central: "#e2231a",
  robinson: "#cc0000",
};

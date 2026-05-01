/**
 * Web-side affiliate URL builder.
 * Mirror of src/adapters/affiliate-links.ts but importable in Astro components.
 *
 * Astro can't easily import from outside src/web/, so we duplicate the URL building
 * logic here. Keep in sync — both files small and stable.
 */

export type Platform = "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";

export interface AffiliateUrlInput {
  platform: Platform;
  externalId: string;
  shopExternalId?: string | null;
  subId: string;
}

const SHOPEE_AFFILIATE_ID =
  import.meta.env.SHOPEE_AFFILIATE_ID ?? process.env.SHOPEE_AFFILIATE_ID ?? "";
const SHOPEE_TRACKING_ID =
  import.meta.env.SHOPEE_TRACKING_ID ?? process.env.SHOPEE_TRACKING_ID ?? "";
const LAZADA_AFFILIATE_ID =
  import.meta.env.LAZADA_AFFILIATE_ID ?? process.env.LAZADA_AFFILIATE_ID ?? "";
const TIKTOK_SHOP_AFFILIATE_ID =
  import.meta.env.TIKTOK_SHOP_AFFILIATE_ID ?? process.env.TIKTOK_SHOP_AFFILIATE_ID ?? "";

const PLATFORM_BUILDERS: Record<Platform, (input: AffiliateUrlInput) => string | null> = {
  shopee: ({ shopExternalId, externalId, subId }) => {
    if (!shopExternalId) return null;
    const params = new URLSearchParams();
    params.set("af_sub1", subId);
    if (SHOPEE_AFFILIATE_ID) params.set("affiliate_id", SHOPEE_AFFILIATE_ID);
    if (SHOPEE_TRACKING_ID) params.set("af_sub_pub", SHOPEE_TRACKING_ID);
    return `https://shopee.co.th/product/${shopExternalId}/${externalId}?${params}`;
  },

  lazada: ({ externalId, subId }) => {
    const params = new URLSearchParams();
    if (LAZADA_AFFILIATE_ID) params.set("aff_short_key", LAZADA_AFFILIATE_ID);
    params.set("sub_aff_id", subId);
    return `https://www.lazada.co.th/products/-i${externalId}.html?${params}`;
  },

  tiktok_shop: ({ externalId, subId }) => {
    if (!TIKTOK_SHOP_AFFILIATE_ID) return null;
    return `https://shop.tiktok.com/view/product/${externalId}?utm_source=affiliate&utm_medium=${TIKTOK_SHOP_AFFILIATE_ID}&utm_campaign=${subId}`;
  },

  jd_central: ({ externalId, subId }) =>
    `https://www.jd.co.th/product/${externalId}?ref=${subId}`,

  robinson: ({ externalId, subId }) =>
    `https://www.robinson.co.th/product/${externalId}?ref=${subId}`,
};

export function buildAffiliateUrl(input: AffiliateUrlInput): string | null {
  const builder = PLATFORM_BUILDERS[input.platform];
  return builder ? builder(input) : null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  shopee: "Shopee",
  lazada: "Lazada",
  tiktok_shop: "TikTok Shop",
  jd_central: "JD Central",
  robinson: "Robinson",
};

/** Domain shown in CTA button (e.g. "ดูที่ Shopee →"). */
export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

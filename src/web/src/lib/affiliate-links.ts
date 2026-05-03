/**
 * Web-side affiliate URL builder.
 * Mirror of src/adapters/affiliate-links.ts but importable in Astro components.
 *
 * Astro can't easily import from outside src/web/, so we duplicate the URL building
 * logic here. Keep in sync — both files small and stable.
 */

export type Platform = "shopee" | "tiktok_shop";

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

  tiktok_shop: ({ externalId, subId }) => {
    if (!TIKTOK_SHOP_AFFILIATE_ID) return null;
    return `https://shop.tiktok.com/view/product/${externalId}?utm_source=affiliate&utm_medium=${TIKTOK_SHOP_AFFILIATE_ID}&utm_campaign=${subId}`;
  },
};

export function buildAffiliateUrl(input: AffiliateUrlInput): string | null {
  const builder = PLATFORM_BUILDERS[input.platform];
  return builder ? builder(input) : null;
}

export const PLATFORM_LABELS: Record<Platform, string> = {
  shopee: "Shopee",
  tiktok_shop: "TikTok Shop",
};

/** Domain shown in CTA button (e.g. "ดูที่ Shopee →"). */
export function platformLabel(platform: Platform): string {
  return PLATFORM_LABELS[platform];
}

/**
 * Choose the best link for a product card, given whether a review page exists.
 * - If review page exists → internal /รีวิว/{slug} (more pages indexed by Google + sticks user on site)
 * - Otherwise → direct affiliate URL to Shopee (better than 404)
 */
export function bestProductLink(input: {
  hasReviewPage?: boolean;
  slug: string;
  platform: Platform;
  externalId: string;
  shopExternalId?: string | null;
  subId: string;
  /** UI language — defaults to "th" for legacy callers. Used to build the localized review URL. */
  lang?: "th" | "en" | "zh" | "ja";
}): { href: string; external: boolean } {
  if (input.hasReviewPage) {
    const lang = input.lang ?? "th";
    return { href: `/${lang}/รีวิว/${input.slug}`, external: false };
  }
  const url = buildAffiliateUrl({
    platform: input.platform,
    externalId: input.externalId,
    shopExternalId: input.shopExternalId,
    subId: input.subId,
  });
  // Last-resort fallback: if affiliate URL fails (e.g. missing IDs), still send to Shopee homepage.
  return {
    href: url ?? "https://shopee.co.th",
    external: true,
  };
}

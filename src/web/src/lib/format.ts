/**
 * Mirror of /src/lib/format.ts — kept inline for Astro build hermeticity.
 */

const satangFmt = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export function formatBaht(satang: number | null | undefined): string {
  if (satang == null) return "—";
  return satangFmt.format(Math.round(satang / 100));
}

export function bahtFromSatang(satang: number): number {
  return satang / 100;
}

const percentFmt = new Intl.NumberFormat("th-TH", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return percentFmt.format(ratio);
}

export function compactCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1_000) return n.toString();
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/**
 * @deprecated Use buildAffiliateUrl({ platform: "shopee", ... }) from ./affiliate-links instead.
 * Kept for backward compatibility with any older code paths.
 */
export function shopeeAffiliateUrl(
  shopExternalId: string,
  itemExternalId: string,
  subId: string,
): string {
  const params = new URLSearchParams();
  params.set("af_sub1", subId);
  const affiliateId = import.meta.env.SHOPEE_AFFILIATE_ID ?? process.env.SHOPEE_AFFILIATE_ID;
  if (affiliateId) params.set("affiliate_id", affiliateId);
  return `https://shopee.co.th/product/${shopExternalId}/${itemExternalId}?${params}`;
}

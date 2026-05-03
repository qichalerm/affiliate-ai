/**
 * TikTok Shop product persistence — Sprint 26.
 *
 * Reuses products + product_prices schema. Sets platform="tiktok_shop"
 * and uses TikTok shop URLs for the affiliate destination. Same pattern
 * as Shopee persist (snapshot price + auto-create web affiliate link).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";
import { createAffiliateLink } from "../../affiliate/link-generator.ts";
import type { TikTokShopProduct, Niche } from "./types.ts";

const log = child("tiktok-shop.persist");

function tiktokShopSlug(name: string, externalId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^฀-๿a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base}-${externalId}`;
}

interface UpsertResult { id: number; isNew: boolean }

export async function upsertTikTokShopProduct(
  product: TikTokShopProduct,
  niche?: Niche,
): Promise<UpsertResult> {
  const slug = tiktokShopSlug(product.name, product.externalId);

  const existing = await db.query.products.findFirst({
    where: (p, { and }) => and(eq(p.platform, "tiktok_shop"), eq(p.externalId, product.externalId)),
    columns: { id: true, currentPrice: true },
  });

  const sharedFields = {
    primaryImage: product.primaryImage ?? null,
    imageUrls: (product.imageUrls ?? []) as string[],
    currentPrice: product.currentPriceSatang,
    originalPrice: product.originalPriceSatang ?? null,
    discountPercent: product.discountPercent ?? null,
    rating: product.rating ?? null,
    ratingCount: product.ratingCount ?? null,
    soldCount: product.soldCount ?? null,
    soldCount30d: product.soldCount30d ?? null,
    viewCount: product.viewCount ?? null,
    likeCount: product.likeCount ?? null,
    lastScrapedAt: new Date(),
  };

  if (existing) {
    await db
      .update(schema.products)
      .set({
        ...sharedFields,
        ...(niche ? { niche } : {}),
        ...(product.description ? { description: product.description } : {}),
      })
      .where(eq(schema.products.id, existing.id));

    await db.insert(schema.productPrices).values({
      productId: existing.id,
      price: product.currentPriceSatang,
      originalPrice: product.originalPriceSatang ?? null,
      soldCount: sharedFields.soldCount ?? null,
      ratingCount: sharedFields.ratingCount ?? null,
    });
    return { id: existing.id, isNew: false };
  }

  const [row] = await db
    .insert(schema.products)
    .values({
      platform: "tiktok_shop",
      externalId: product.externalId,
      shopId: null,  // TikTok shop_id not always meaningful; skip FK setup for now
      niche: niche ?? null,
      name: product.name,
      slug,
      brand: product.brand ?? null,
      description: product.description ?? null,
      ...sharedFields,
      raw: product.raw as Record<string, unknown>,
    })
    .returning({ id: schema.products.id });

  await db.insert(schema.productPrices).values({
    productId: row!.id,
    price: product.currentPriceSatang,
    originalPrice: product.originalPriceSatang ?? null,
    soldCount: sharedFields.soldCount ?? null,
    ratingCount: sharedFields.ratingCount ?? null,
  });

  // Auto-create web channel affiliate link
  try {
    await createAffiliateLink({
      productId: row!.id,
      channel: "web",
      campaign: "tiktok_shop_auto_on_scrape",
    });
  } catch (err) {
    log.warn({ productId: row!.id, err: errMsg(err) }, "tiktok shop auto-link create failed");
  }

  return { id: row!.id, isNew: true };
}

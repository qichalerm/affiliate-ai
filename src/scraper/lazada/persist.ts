/**
 * Persist scraped Lazada data into the (shared) products + shops tables.
 * Idempotent — safe to re-run.
 */

import { db, schema } from "../../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import type { LazadaProduct, LazadaShop } from "./types.ts";
import { productSlug } from "../../lib/slugify.ts";
import { child } from "../../lib/logger.ts";

const log = child("lazada.persist");

export async function upsertShop(shop: LazadaShop): Promise<number> {
  const reliability = shop.isLazMall ? 0.85 : 0.5;

  const [row] = await db
    .insert(schema.shops)
    .values({
      platform: "lazada",
      externalId: shop.externalId,
      name: shop.name,
      isMall: shop.isLazMall,
      isPreferred: false,
      rating: shop.rating,
      followerCount: shop.followerCount,
      shipFromLocation: shop.shipFromLocation,
      reliabilityScore: reliability,
      raw: shop.raw as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [schema.shops.platform, schema.shops.externalId],
      set: {
        name: shop.name,
        isMall: shop.isLazMall,
        rating: shop.rating,
        reliabilityScore: reliability,
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: schema.shops.id });
  return row.id;
}

export async function upsertProduct(
  product: LazadaProduct,
  shopDbId: number,
): Promise<{ id: number; isNew: boolean }> {
  const slug = productSlug(product.name, product.externalId, product.brand);

  const existing = await db.query.products.findFirst({
    where: (p, { and }) => and(eq(p.platform, "lazada"), eq(p.externalId, product.externalId)),
    columns: { id: true, currentPrice: true },
  });

  const values = {
    platform: "lazada" as const,
    externalId: product.externalId,
    shopId: shopDbId,
    name: product.name,
    slug,
    brand: product.brand,
    descriptionRaw: product.description,
    specifications: product.specifications,
    primaryImage: product.primaryImage,
    imageUrls: product.imageUrls,
    hasVariants: false,
    currentPrice: product.currentPriceSatang,
    originalPrice: product.originalPriceSatang,
    discountPercent: product.discountPercent,
    stock: product.stock,
    rating: product.rating,
    ratingCount: product.ratingCount,
    soldCount: product.soldCount,
    hasFreeShipping: product.hasFreeShipping,
    hasVoucher: false,
    lastScrapedAt: new Date(),
    raw: product.raw as Record<string, unknown>,
  };

  if (existing) {
    await db
      .update(schema.products)
      .set({
        currentPrice: values.currentPrice,
        originalPrice: values.originalPrice,
        discountPercent: values.discountPercent,
        rating: values.rating,
        ratingCount: values.ratingCount,
        soldCount: values.soldCount,
        hasFreeShipping: values.hasFreeShipping,
        descriptionRaw: values.descriptionRaw ?? sql`description_raw`,
        lastScrapedAt: values.lastScrapedAt,
      })
      .where(eq(schema.products.id, existing.id));

    if (existing.currentPrice !== values.currentPrice) {
      await db.insert(schema.productPrices).values({
        productId: existing.id,
        price: values.currentPrice,
        originalPrice: values.originalPrice,
      });
    }
    return { id: existing.id, isNew: false };
  }

  const [row] = await db
    .insert(schema.products)
    .values(values)
    .returning({ id: schema.products.id });

  await db.insert(schema.productPrices).values({
    productId: row.id,
    price: values.currentPrice,
    originalPrice: values.originalPrice,
  });

  log.debug({ productId: row.id, name: product.name }, "inserted lazada product");
  return { id: row.id, isNew: true };
}

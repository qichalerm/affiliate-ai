/**
 * Persist scraped Shopee data into the database.
 * Idempotent — safe to re-run on the same product.
 */

import { db, schema } from "../../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import type { ShopeeProduct, ShopeeShop, ShopeeReview } from "./types.ts";
import { productSlug } from "../../lib/slugify.ts";
import { child } from "../../lib/logger.ts";

const log = child("shopee.persist");

export async function upsertShop(shop: ShopeeShop): Promise<number> {
  const [row] = await db
    .insert(schema.shops)
    .values({
      platform: "shopee",
      externalId: shop.externalId,
      name: shop.name,
      isMall: shop.isMall,
      isPreferred: shop.isPreferred,
      rating: shop.rating,
      ratingCount: shop.ratingCount,
      followerCount: shop.followerCount,
      productCount: shop.productCount,
      responseRate: shop.responseRate,
      responseTimeHours: shop.responseTimeHours,
      shipFromLocation: shop.shipFromLocation,
      createdSinceDays: shop.createdSinceDays,
      reliabilityScore: computeReliabilityScore(shop),
      raw: shop.raw as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [schema.shops.platform, schema.shops.externalId],
      set: {
        name: shop.name,
        isMall: shop.isMall,
        isPreferred: shop.isPreferred,
        rating: shop.rating,
        ratingCount: shop.ratingCount,
        followerCount: shop.followerCount,
        productCount: shop.productCount,
        responseRate: shop.responseRate,
        responseTimeHours: shop.responseTimeHours,
        reliabilityScore: computeReliabilityScore(shop),
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: schema.shops.id });
  return row.id;
}

function computeReliabilityScore(shop: ShopeeShop): number {
  let score = 0.5;
  if (shop.isMall) score += 0.2;
  else if (shop.isPreferred) score += 0.1;
  if (shop.rating != null) score += (shop.rating - 4) * 0.1; // 4.0 = 0, 5.0 = +0.1
  if (shop.responseRate != null) score += (shop.responseRate - 0.8) * 0.3;
  if (shop.createdSinceDays != null) {
    if (shop.createdSinceDays < 90) score -= 0.2;
    else if (shop.createdSinceDays > 730) score += 0.05;
  }
  if (shop.productCount != null && shop.productCount > 1000) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

export async function upsertProduct(
  product: ShopeeProduct,
  shopDbId: number,
): Promise<{ id: number; isNew: boolean }> {
  const slug = productSlug(product.name, product.externalId, product.brand);

  const existing = await db.query.products.findFirst({
    where: (p, { and }) => and(eq(p.platform, "shopee"), eq(p.externalId, product.externalId)),
    columns: { id: true, currentPrice: true },
  });

  const values = {
    platform: "shopee" as const,
    externalId: product.externalId,
    shopId: shopDbId,
    categoryId: product.categoryId ?? null,
    name: product.name,
    slug,
    brand: product.brand,
    descriptionRaw: product.description,
    specifications: product.specifications,
    primaryImage: product.primaryImage,
    imageUrls: product.imageUrls,
    hasVariants: Boolean(product.variants?.length),
    variants: product.variants,
    currentPrice: product.currentPriceSatang,
    originalPrice: product.originalPriceSatang,
    discountPercent: product.discountPercent,
    stock: product.stock,
    rating: product.rating,
    ratingCount: product.ratingCount,
    soldCount: product.soldCount,
    soldCount30d: product.soldCount30d,
    viewCount: product.viewCount,
    likeCount: product.likeCount,
    hasFreeShipping: product.hasFreeShipping,
    hasVoucher: product.hasVoucher,
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
        stock: values.stock,
        rating: values.rating,
        ratingCount: values.ratingCount,
        soldCount: values.soldCount,
        soldCount30d: values.soldCount30d,
        viewCount: values.viewCount,
        likeCount: values.likeCount,
        hasFreeShipping: values.hasFreeShipping,
        hasVoucher: values.hasVoucher,
        descriptionRaw: values.descriptionRaw ?? sql`description_raw`,
        specifications: values.specifications ?? sql`specifications`,
        lastScrapedAt: values.lastScrapedAt,
      })
      .where(eq(schema.products.id, existing.id));

    // Append to price history if price changed
    if (existing.currentPrice !== values.currentPrice) {
      await db.insert(schema.productPrices).values({
        productId: existing.id,
        price: values.currentPrice,
        originalPrice: values.originalPrice,
        stock: values.stock,
      });
    }
    return { id: existing.id, isNew: false };
  }

  const [row] = await db
    .insert(schema.products)
    .values(values)
    .returning({ id: schema.products.id });

  // Initial price record
  await db.insert(schema.productPrices).values({
    productId: row.id,
    price: values.currentPrice,
    originalPrice: values.originalPrice,
    stock: values.stock,
  });

  log.debug({ productId: row.id, name: product.name }, "inserted new product");
  return { id: row.id, isNew: true };
}

export async function insertReviews(
  productDbId: number,
  reviews: ShopeeReview[],
): Promise<number> {
  if (reviews.length === 0) return 0;
  const result = await db
    .insert(schema.productReviews)
    .values(
      reviews.map((r) => ({
        productId: productDbId,
        externalId: r.externalId,
        rating: r.rating,
        body: r.body,
        reviewerNameMasked: r.reviewerName,
        isVerified: r.isVerified,
        helpfulCount: r.helpfulCount,
        capturedAt: r.capturedAt,
      })),
    )
    .onConflictDoNothing({
      target: [schema.productReviews.productId, schema.productReviews.externalId],
    });
  return result.length;
}

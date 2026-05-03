/**
 * Persist Shopee scrape results to Postgres.
 * Idempotent — safe to re-run on the same product (upsert by platform+external_id).
 *
 * For each new product, also auto-creates a "web" channel affiliate link
 * via M8 (Sprint 1) so click tracking is wired from the moment the product
 * lands in our DB.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";
import { createAffiliateLink } from "../../affiliate/link-generator.ts";
import { productSlug } from "./slug.ts";
import type { Niche, ShopeeProduct, ShopeeShop } from "./types.ts";

const log = child("shopee.persist");

/* ----- Shop ---------------------------------------------------------- */

function computeReliabilityScore(shop: ShopeeShop): number {
  let score = 0.5;
  if (shop.isMall) score += 0.2;
  else if (shop.isPreferred) score += 0.1;
  if (shop.rating != null) score += (shop.rating - 4) * 0.1; // 4.0 = +0, 5.0 = +0.1
  if (shop.responseRate != null) score += (shop.responseRate - 0.8) * 0.3;
  if (shop.createdSinceDays != null) {
    if (shop.createdSinceDays < 90) score -= 0.2;
    else if (shop.createdSinceDays > 730) score += 0.05;
  }
  if (shop.productCount != null && shop.productCount > 1000) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

export async function upsertShop(shop: ShopeeShop): Promise<number> {
  const [row] = await db
    .insert(schema.shops)
    .values({
      platform: "shopee",
      externalId: shop.externalId,
      name: shop.name,
      isMall: shop.isMall,
      isPreferred: shop.isPreferred,
      rating: shop.rating ?? null,
      ratingCount: shop.ratingCount ?? null,
      followerCount: shop.followerCount ?? null,
      productCount: shop.productCount ?? null,
      responseRate: shop.responseRate ?? null,
      responseTimeHours: shop.responseTimeHours ?? null,
      shipFromLocation: shop.shipFromLocation ?? null,
      createdSinceDays: shop.createdSinceDays ?? null,
      reliabilityScore: computeReliabilityScore(shop),
      raw: shop.raw as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [schema.shops.platform, schema.shops.externalId],
      set: {
        name: shop.name,
        isMall: shop.isMall,
        isPreferred: shop.isPreferred,
        rating: shop.rating ?? null,
        ratingCount: shop.ratingCount ?? null,
        followerCount: shop.followerCount ?? null,
        productCount: shop.productCount ?? null,
        responseRate: shop.responseRate ?? null,
        reliabilityScore: computeReliabilityScore(shop),
        lastSeenAt: new Date(),
      },
    })
    .returning({ id: schema.shops.id });
  return row!.id;
}

/* ----- Product ------------------------------------------------------- */

export interface UpsertProductResult {
  id: number;
  isNew: boolean;
  priceChanged: boolean;
}

export async function upsertProduct(
  product: ShopeeProduct,
  shopDbId: number,
  niche?: Niche,
  categoryId?: number,
): Promise<UpsertProductResult> {
  const slug = productSlug(product.name, product.externalId, product.brand);

  const existing = await db.query.products.findFirst({
    where: (p, { and }) => and(eq(p.platform, "shopee"), eq(p.externalId, product.externalId)),
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
        primaryImage: sharedFields.primaryImage,
        imageUrls: sharedFields.imageUrls,
        currentPrice: sharedFields.currentPrice,
        originalPrice: sharedFields.originalPrice,
        discountPercent: sharedFields.discountPercent,
        rating: sharedFields.rating,
        ratingCount: sharedFields.ratingCount,
        soldCount: sharedFields.soldCount,
        soldCount30d: sharedFields.soldCount30d,
        viewCount: sharedFields.viewCount,
        likeCount: sharedFields.likeCount,
        lastScrapedAt: sharedFields.lastScrapedAt,
        // Only overwrite description if scraper returned one (avoid wiping existing)
        ...(product.description ? { description: product.description } : {}),
      })
      .where(eq(schema.products.id, existing.id));

    const priceChanged = existing.currentPrice !== product.currentPriceSatang;
    if (priceChanged) {
      await db.insert(schema.productPrices).values({
        productId: existing.id,
        price: product.currentPriceSatang,
        originalPrice: product.originalPriceSatang ?? null,
      });
    }
    return { id: existing.id, isNew: false, priceChanged };
  }

  // New product
  const [row] = await db
    .insert(schema.products)
    .values({
      platform: "shopee",
      externalId: product.externalId,
      shopId: shopDbId,
      categoryId: categoryId ?? null,
      name: product.name,
      slug,
      brand: product.brand ?? null,
      description: product.description ?? null,
      primaryImage: sharedFields.primaryImage,
      imageUrls: sharedFields.imageUrls,
      currentPrice: sharedFields.currentPrice,
      originalPrice: sharedFields.originalPrice,
      discountPercent: sharedFields.discountPercent,
      rating: sharedFields.rating,
      ratingCount: sharedFields.ratingCount,
      soldCount: sharedFields.soldCount,
      soldCount30d: sharedFields.soldCount30d,
      viewCount: sharedFields.viewCount,
      likeCount: sharedFields.likeCount,
      raw: product.raw as Record<string, unknown>,
    })
    .returning({ id: schema.products.id });

  // Initial price record
  await db.insert(schema.productPrices).values({
    productId: row!.id,
    price: product.currentPriceSatang,
    originalPrice: product.originalPriceSatang ?? null,
  });

  // Auto-create "web" channel affiliate link (M8 integration)
  // Other channels (FB/IG/TikTok) get links lazily when content is generated for them.
  try {
    await createAffiliateLink({
      productId: row!.id,
      channel: "web",
      campaign: "auto_on_scrape",
    });
  } catch (err) {
    log.warn(
      { productId: row!.id, err: errMsg(err) },
      "auto-create web link failed (non-fatal)",
    );
  }

  log.debug({ productId: row!.id, name: product.name, niche }, "inserted new product");
  return { id: row!.id, isNew: true, priceChanged: false };
}

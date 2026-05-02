/**
 * Database queries used by Astro static-build pages.
 * All return plain serializable objects (no class instances).
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ProductRow {
  id: number;
  slug: string;
  platform: "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";
  name: string;
  brand: string | null;
  primaryImage: string | null;
  imageUrls: string[];
  currentPrice: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  externalId: string;
  shopId: number | null;
  shopExternalId: string | null;
  shopName: string | null;
  isMall: boolean;
  specifications: Record<string, string> | null;
  description: string | null;
  categoryId: number | null;
  /** True when a published content_page exists — UI uses this to choose between /รีวิว/{slug} and direct affiliate URL. */
  hasReviewPage?: boolean;
}

export interface CrossPlatformMatch {
  matchedProductId: number;
  platform: "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";
  name: string;
  brand: string | null;
  externalId: string;
  shopExternalId: string | null;
  currentPrice: number | null;
  rating: number | null;
  matchConfidence: number;
}

export interface RelatedLink {
  type: "review" | "comparison" | "best_of";
  slug: string;
  title: string;
  thumbnail?: string | null;
  reason: string;
}

export interface ContentPageRow {
  id: number;
  slug: string;
  type: string;
  title: string;
  metaDescription: string | null;
  h1: string | null;
  primaryProductId: number | null;
  contentJson: Record<string, unknown> | null;
  schemaJsonLd: Record<string, unknown> | null;
  ogImage: string | null;
  keywords: string[];
  publishedAt: Date | null;
}

export interface ReviewRow {
  rating: number | null;
  body: string;
  reviewerNameMasked: string | null;
  capturedAt: Date;
}

export interface PriceHistoryPoint {
  capturedAt: Date;
  price: number;
}

export async function getAllPublishedReviewPages(): Promise<ContentPageRow[]> {
  const rows = await db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE status = 'published'
       AND type = 'review'
  `);
  return rows;
}

export async function getReviewPageBySlug(slug: string): Promise<{
  page: ContentPageRow;
  product: ProductRow;
  reviews: ReviewRow[];
  priceHistory: PriceHistoryPoint[];
} | null> {
  const pages = await db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE slug = ${slug} AND status = 'published'
     LIMIT 1
  `);
  const page = pages[0];
  if (!page) return null;

  const productRows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId",
           EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status='published') AS "hasReviewPage"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.id = ${page.primaryProductId}
     LIMIT 1
  `);
  const product = productRows[0];
  if (!product) return null;

  const reviews = await db.execute<ReviewRow>(sql`
    SELECT rating, body, reviewer_name_masked AS "reviewerNameMasked", captured_at AS "capturedAt"
      FROM product_reviews
     WHERE product_id = ${product.id}
     ORDER BY captured_at DESC
     LIMIT 8
  `);

  const priceHistory = await db.execute<PriceHistoryPoint>(sql`
    SELECT captured_at AS "capturedAt", price
      FROM product_prices
     WHERE product_id = ${product.id}
     ORDER BY captured_at ASC
     LIMIT 200
  `);

  const crossPlatform = await getCrossPlatformMatches(product.id);

  return { page, product, reviews, priceHistory, crossPlatform };
}

/**
 * Get matched products on other platforms (for cross-platform price compare card).
 */
export async function getCrossPlatformMatches(productId: number): Promise<CrossPlatformMatch[]> {
  return db.execute<CrossPlatformMatch>(sql`
    SELECT pc.matched_product_id AS "matchedProductId",
           p.platform::text AS platform,
           p.name, p.brand,
           p.external_id AS "externalId",
           s.external_id AS "shopExternalId",
           p.current_price AS "currentPrice",
           p.rating,
           pc.match_confidence AS "matchConfidence"
      FROM price_compare pc
      JOIN products p ON p.id = pc.matched_product_id
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE pc.primary_product_id = ${productId}
       AND p.is_active = true
       AND p.flag_blacklisted = false
       AND pc.match_confidence >= 0.7
     ORDER BY pc.match_confidence DESC, p.current_price ASC
     LIMIT 5
  `);
}

export async function getTopProducts(limit = 24): Promise<ProductRow[]> {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId",
           EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status='published') AS "hasReviewPage"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.current_price IS NOT NULL
       AND p.rating >= 4.0
       AND EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status = 'published')
     ORDER BY COALESCE(p.final_score, p.sold_count, 0) DESC NULLS LAST
     LIMIT ${limit}
  `);
  return rows;
}

export async function getDealsToday(limit = 24): Promise<ProductRow[]> {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId",
           EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status='published') AS "hasReviewPage"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.discount_percent >= 0.20
       AND p.rating >= 4.0
     ORDER BY p.discount_percent DESC NULLS LAST
     LIMIT ${limit}
  `);
  return rows;
}

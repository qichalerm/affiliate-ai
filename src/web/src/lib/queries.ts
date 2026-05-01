/**
 * Database queries used by Astro static-build pages.
 * All return plain serializable objects (no class instances).
 */

import { db } from "./db";
import { sql } from "drizzle-orm";

export interface ProductRow {
  id: number;
  slug: string;
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
    SELECT p.id, p.slug, p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId"
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

  return { page, product, reviews, priceHistory };
}

export async function getTopProducts(limit = 24): Promise<ProductRow[]> {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.slug, p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.current_price IS NOT NULL
       AND p.rating >= 4.0
     ORDER BY COALESCE(p.final_score, p.sold_count, 0) DESC NULLS LAST
     LIMIT ${limit}
  `);
  return rows;
}

export async function getDealsToday(limit = 24): Promise<ProductRow[]> {
  const rows = await db.execute<ProductRow>(sql`
    SELECT p.id, p.slug, p.name, p.brand, p.primary_image AS "primaryImage",
           COALESCE(p.image_urls, '[]'::jsonb) AS "imageUrls",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent", p.rating, p.rating_count AS "ratingCount",
           p.sold_count AS "soldCount", p.external_id AS "externalId",
           p.shop_id AS "shopId", s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall",
           p.specifications, p.description_raw AS description,
           p.category_id AS "categoryId"
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

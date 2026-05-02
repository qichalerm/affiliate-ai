import { db } from "./db";
import { sql } from "drizzle-orm";

export interface CategoryRow {
  id: number;
  slug: string;
  nameTh: string;
  nameEn: string | null;
  parentId: number | null;
  depth: number;
  productCount: number;
}

export async function getAllActiveCategories(): Promise<CategoryRow[]> {
  // productCount = any active product in this category (no longer requires a published
  // content_page, since most Apify-scraped products link out directly to Shopee).
  return db.execute<CategoryRow>(sql`
    SELECT c.id, c.slug, c.name_th AS "nameTh", c.name_en AS "nameEn",
           c.parent_id AS "parentId", c.depth,
           (SELECT COUNT(*)::int FROM products p
             WHERE p.category_id = c.id
               AND p.is_active = true
               AND p.flag_blacklisted = false
           ) AS "productCount"
      FROM categories c
     WHERE c.is_active = true
     ORDER BY c.depth ASC, c.sort_order ASC, c.name_th ASC
  `);
}

export async function getCategoryBySlug(slug: string): Promise<CategoryRow | null> {
  const rows = await db.execute<CategoryRow>(sql`
    SELECT c.id, c.slug, c.name_th AS "nameTh", c.name_en AS "nameEn",
           c.parent_id AS "parentId", c.depth,
           0 AS "productCount"
      FROM categories c
     WHERE c.slug = ${slug} AND c.is_active = true
     LIMIT 1
  `);
  return rows[0] ?? null;
}

export interface CategoryProduct {
  id: number;
  slug: string;
  platform: "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";
  name: string;
  brand: string | null;
  primaryImage: string | null;
  currentPrice: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  isMall: boolean;
  externalId: string;
  shopExternalId: string | null;
  hasReviewPage: boolean;
}

export async function getTopProductsInCategory(
  categoryId: number,
  limit = 24,
): Promise<CategoryProduct[]> {
  // Returns ANY active product in the category (was filtered to "with published page",
  // but most Apify-sourced products don't have pages yet — they fall back to
  // direct affiliate URLs via bestProductLink).
  return db.execute<CategoryProduct>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand, p.primary_image AS "primaryImage",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent",
           p.rating, p.rating_count AS "ratingCount", p.sold_count AS "soldCount",
           COALESCE(s.is_mall, false) AS "isMall",
           p.external_id AS "externalId",
           s.external_id AS "shopExternalId",
           EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status='published') AS "hasReviewPage"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.category_id = ${categoryId}
       AND p.is_active = true
       AND p.flag_blacklisted = false
       AND p.current_price > 0
     ORDER BY p.final_score DESC NULLS LAST,
              p.sold_count DESC NULLS LAST,
              p.rating_count DESC NULLS LAST,
              p.rating DESC NULLS LAST
     LIMIT ${limit}
  `);
}

export async function getBestOfPagesInCategory(categoryId: number): Promise<
  Array<{ slug: string; title: string; variant: string | null }>
> {
  return db.execute<{ slug: string; title: string; variant: string | null }>(sql`
    SELECT slug, title, content_json->>'variant' AS variant
      FROM content_pages
     WHERE status = 'published'
       AND type = 'best_of'
       AND category_id = ${categoryId}
     ORDER BY published_at DESC
     LIMIT 8
  `);
}

export async function getSubcategories(parentId: number): Promise<CategoryRow[]> {
  return db.execute<CategoryRow>(sql`
    SELECT c.id, c.slug, c.name_th AS "nameTh", c.name_en AS "nameEn",
           c.parent_id AS "parentId", c.depth,
           (SELECT COUNT(*)::int FROM products p
             WHERE p.category_id = c.id
               AND p.is_active = true) AS "productCount"
      FROM categories c
     WHERE c.parent_id = ${parentId}
       AND c.is_active = true
     ORDER BY c.sort_order ASC, c.name_th ASC
  `);
}

import { db } from "./db";
import { sql } from "drizzle-orm";
import type { ContentPageRow } from "./queries";

interface ComparisonProductInner {
  id: number;
  slug: string;
  platform: "shopee" | "tiktok_shop";
  name: string;
  brand: string | null;
  priceSatang: number | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  primaryImage: string | null;
  shop: { name: string | null; isMall: boolean };
  externalId: string;
  shopExternalId: string | null;
}

export interface ComparisonContent {
  type: "comparison";
  productA: ComparisonProductInner;
  productB: ComparisonProductInner;
  intro: string;
  differences: Array<{ aspect: string; winner: "a" | "b" | "tie"; note: string }>;
  bestForA: string;
  bestForB: string;
  verdict: string;
}

export async function getAllPublishedComparisons(): Promise<ContentPageRow[]> {
  return db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE status = 'published' AND type = 'comparison'
  `);
}

export async function getComparisonBySlug(
  slug: string,
): Promise<ContentPageRow | null> {
  const rows = await db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE slug = ${slug} AND status = 'published' AND type = 'comparison'
     LIMIT 1
  `);
  return rows[0] ?? null;
}

export interface BestOfContent {
  type: "best_of";
  variant: string;
  variantLabel: string;
  categoryId: number;
  categoryName: string;
  year: number;
  intro: string;
  criteria: string;
  tagline: string;
  items: Array<{
    rank: number;
    productId: number;
    name: string;
    brand: string | null;
    priceSatang: number | null;
    rating: number | null;
    soldCount: number | null;
    primaryImage: string | null;
  }>;
}

export async function getAllPublishedBestOf(): Promise<ContentPageRow[]> {
  return db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE status = 'published' AND type = 'best_of'
  `);
}

export async function getBestOfBySlug(slug: string): Promise<ContentPageRow | null> {
  const rows = await db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE slug = ${slug} AND status = 'published' AND type = 'best_of'
     LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Look up product slugs for best-of items (so links can navigate to review pages).
 */
export async function getProductSlugs(
  ids: number[],
): Promise<
  Map<
    number,
    {
      slug: string;
      platform: "shopee" | "tiktok_shop";
      externalId: string;
      shopExternalId: string | null;
    }
  >
> {
  if (ids.length === 0) return new Map();
  const rows = await db.execute<{
    id: number;
    slug: string;
    platform: "shopee" | "tiktok_shop";
    externalId: string;
    shopExternalId: string | null;
  }>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.external_id AS "externalId", s.external_id AS "shopExternalId"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
  `);
  const map = new Map<
    number,
    {
      slug: string;
      platform: "shopee" | "tiktok_shop";
      externalId: string;
      shopExternalId: string | null;
    }
  >();
  for (const r of rows) map.set(r.id, r);
  return map;
}

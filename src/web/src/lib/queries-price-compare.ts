import { db } from "./db";
import { sql } from "drizzle-orm";
import type { ContentPageRow } from "./queries";

export interface PriceComparePlatformItem {
  platform: "shopee" | "lazada" | "tiktok_shop" | "jd_central" | "robinson";
  name: string;
  price: number | null;
  shopExternalId: string | null;
  externalId: string;
  rating: number | null;
  primaryImage: string | null;
}

export interface PriceCompareContent {
  type: "price_compare";
  productName: string;
  brand: string | null;
  primaryImage: string | null;
  intro: string;
  bestNow: string;
  primaryProductId: number;
  primaryProductSlug: string;
  platforms: PriceComparePlatformItem[];
  cheapest: string;
}

export async function getAllPublishedPriceCompare(): Promise<ContentPageRow[]> {
  return db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE status = 'published' AND type = 'price_compare'
  `);
}

export async function getPriceCompareBySlug(slug: string): Promise<ContentPageRow | null> {
  const rows = await db.execute<ContentPageRow>(sql`
    SELECT id, slug, type::text AS type, title, meta_description AS "metaDescription",
           h1, primary_product_id AS "primaryProductId", content_json AS "contentJson",
           schema_json_ld AS "schemaJsonLd", og_image AS "ogImage",
           keywords, published_at AS "publishedAt"
      FROM content_pages
     WHERE slug = ${slug} AND status = 'published' AND type = 'price_compare'
     LIMIT 1
  `);
  return rows[0] ?? null;
}

/**
 * Internal linking — populates "related links" on each content page.
 *
 * Strategy (each review/compare/best-of page gets ~6-10 related links):
 *  - Same category, similar price band → 3 review pages
 *  - Comparison pages that mention this product → 2 compare pages
 *  - Best-of pages this product appears in → 1 best-of page
 *
 * Stored in content_pages.contentJson.relatedLinks; rendered by Astro templates.
 *
 * Run weekly — internal links don't need real-time updates.
 */

import { db, schema } from "../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("internal-linker");

export interface RelatedLink {
  type: "review" | "comparison" | "best_of";
  slug: string;
  title: string;
  thumbnail?: string | null;
  reason: string; // human-readable hint shown in UI
}

interface PageRow {
  id: number;
  slug: string;
  type: string;
  primary_product_id: number | null;
  related_product_ids: number[] | null;
  category_id: number | null;
}

export async function computeRelatedLinksForReview(productId: number): Promise<RelatedLink[]> {
  // 1. Same-category review pages by price band
  const peerReviews = await db.execute<{
    slug: string;
    title: string;
    primary_image: string | null;
  }>(sql`
    SELECT cp.slug, cp.title, p.primary_image
      FROM content_pages cp
      JOIN products p ON p.id = cp.primary_product_id
     WHERE cp.status = 'published'
       AND cp.type = 'review'
       AND cp.primary_product_id <> ${productId}
       AND p.category_id = (SELECT category_id FROM products WHERE id = ${productId})
       AND p.current_price BETWEEN
            (SELECT current_price FROM products WHERE id = ${productId}) * 0.6
        AND (SELECT current_price FROM products WHERE id = ${productId}) * 1.6
       AND p.is_active = true
     ORDER BY cp.revenue_30d_satang DESC NULLS LAST,
              cp.published_at DESC NULLS LAST
     LIMIT 4
  `);

  // 2. Comparison pages mentioning this product
  const compareLinks = await db.execute<{ slug: string; title: string }>(sql`
    SELECT slug, title
      FROM content_pages
     WHERE status = 'published'
       AND type = 'comparison'
       AND (primary_product_id = ${productId}
            OR ${productId}::text = ANY(SELECT jsonb_array_elements_text(related_product_ids)))
     ORDER BY published_at DESC
     LIMIT 3
  `);

  // 3. Best-of pages this product appears in
  const bestOfLinks = await db.execute<{ slug: string; title: string }>(sql`
    SELECT slug, title
      FROM content_pages
     WHERE status = 'published'
       AND type = 'best_of'
       AND ${productId}::text = ANY(SELECT jsonb_array_elements_text(related_product_ids))
     ORDER BY published_at DESC
     LIMIT 2
  `);

  const links: RelatedLink[] = [];
  for (const r of peerReviews) {
    links.push({
      type: "review",
      slug: r.slug,
      title: r.title,
      thumbnail: r.primary_image,
      reason: "ราคาใกล้กัน",
    });
  }
  for (const c of compareLinks) {
    links.push({ type: "comparison", slug: c.slug, title: c.title, reason: "เปรียบเทียบ" });
  }
  for (const b of bestOfLinks) {
    links.push({ type: "best_of", slug: b.slug, title: b.title, reason: "อยู่ในรายการแนะนำ" });
  }
  return links;
}

export async function computeRelatedLinksForComparison(
  primaryId: number,
  relatedIds: number[],
): Promise<RelatedLink[]> {
  const allIds = [primaryId, ...relatedIds];
  // Other comparisons in same category
  const peerCompares = await db.execute<{ slug: string; title: string }>(sql`
    SELECT cp.slug, cp.title
      FROM content_pages cp
      JOIN products p ON p.id = cp.primary_product_id
     WHERE cp.status = 'published'
       AND cp.type = 'comparison'
       AND cp.primary_product_id <> ${primaryId}
       AND p.category_id = (SELECT category_id FROM products WHERE id = ${primaryId})
     ORDER BY cp.revenue_30d_satang DESC NULLS LAST
     LIMIT 4
  `);

  // Reviews of products being compared
  const reviewLinks = await db.execute<{
    slug: string;
    title: string;
    primary_image: string | null;
  }>(sql`
    SELECT cp.slug, cp.title, p.primary_image
      FROM content_pages cp
      JOIN products p ON p.id = cp.primary_product_id
     WHERE cp.status = 'published'
       AND cp.type = 'review'
       AND cp.primary_product_id IN (${sql.raw(allIds.join(","))})
     LIMIT 3
  `);

  return [
    ...reviewLinks.map((r) => ({
      type: "review" as const,
      slug: r.slug,
      title: r.title,
      thumbnail: r.primary_image,
      reason: "รีวิวเต็ม",
    })),
    ...peerCompares.map((c) => ({
      type: "comparison" as const,
      slug: c.slug,
      title: c.title,
      reason: "เปรียบเทียบในหมวดเดียวกัน",
    })),
  ];
}

export async function computeRelatedLinksForBestOf(
  categoryId: number,
  itemProductIds: number[],
): Promise<RelatedLink[]> {
  // Other variants for same category
  const otherVariants = await db.execute<{ slug: string; title: string }>(sql`
    SELECT slug, title
      FROM content_pages
     WHERE status = 'published'
       AND type = 'best_of'
       AND category_id = ${categoryId}
       AND content_json->>'variant' <> COALESCE((
         SELECT content_json->>'variant'
           FROM content_pages cp2
          WHERE cp2.category_id = ${categoryId}
            AND cp2.type = 'best_of'
          LIMIT 1
       ), '')
     LIMIT 3
  `);

  // Top reviews of items in the list
  const reviewLinks = await db.execute<{
    slug: string;
    title: string;
    primary_image: string | null;
  }>(sql`
    SELECT cp.slug, cp.title, p.primary_image
      FROM content_pages cp
      JOIN products p ON p.id = cp.primary_product_id
     WHERE cp.status = 'published'
       AND cp.type = 'review'
       AND cp.primary_product_id IN (${sql.raw(itemProductIds.length > 0 ? itemProductIds.join(",") : "0")})
     LIMIT 5
  `);

  return [
    ...reviewLinks.map((r) => ({
      type: "review" as const,
      slug: r.slug,
      title: r.title,
      thumbnail: r.primary_image,
      reason: "รีวิวสินค้าในรายการ",
    })),
    ...otherVariants.map((v) => ({
      type: "best_of" as const,
      slug: v.slug,
      title: v.title,
      reason: "หมวดเดียวกัน",
    })),
  ];
}

/**
 * Bulk-update related links on all published content pages.
 * Idempotent — safe to re-run.
 */
export async function refreshAllInternalLinks(): Promise<{
  updated: number;
  failed: number;
}> {
  const pages = await db.execute<PageRow>(sql`
    SELECT id, slug, type::text AS type,
           primary_product_id,
           CASE WHEN related_product_ids IS NULL THEN ARRAY[]::int[]
                ELSE ARRAY(SELECT (jsonb_array_elements_text(related_product_ids))::int) END AS related_product_ids,
           category_id
      FROM content_pages
     WHERE status = 'published'
  `);

  log.info({ pages: pages.length }, "refreshing internal links");

  let updated = 0;
  let failed = 0;

  for (const page of pages) {
    try {
      let links: RelatedLink[] = [];
      if (page.type === "review" && page.primary_product_id) {
        links = await computeRelatedLinksForReview(page.primary_product_id);
      } else if (page.type === "comparison" && page.primary_product_id) {
        links = await computeRelatedLinksForComparison(
          page.primary_product_id,
          page.related_product_ids ?? [],
        );
      } else if (page.type === "best_of" && page.category_id) {
        links = await computeRelatedLinksForBestOf(
          page.category_id,
          page.related_product_ids ?? [],
        );
      }

      if (links.length > 0) {
        await db
          .update(schema.contentPages)
          .set({
            contentJson: sql`jsonb_set(content_json, '{relatedLinks}', ${JSON.stringify(links)}::jsonb)`,
            updatedAt: new Date(),
          })
          .where(eq(schema.contentPages.id, page.id));
        updated++;
      }
    } catch (err) {
      failed++;
      log.warn({ pageId: page.id, err: errMsg(err) }, "internal link refresh failed");
    }
  }

  log.info({ updated, failed }, "internal links refresh done");
  return { updated, failed };
}

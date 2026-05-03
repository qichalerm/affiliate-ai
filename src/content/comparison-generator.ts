/**
 * Comparison page generator (A vs B).
 *
 * Strategy:
 *  - Pick eligible product pairs: same category, similar AOV (within 30%),
 *    both have rating + reviews, both score > 0.5
 *  - Limit pairs by category to avoid explosion (top 10 per category × 5 = 50 pairs)
 *  - Generate 1 LLM call per pair (Sonnet for nuanced judgment)
 *  - Auto-pick winner per aspect using real data, not just LLM opinion
 */

import { db, schema } from "../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import { complete } from "../lib/claude.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { bahtFromSatang } from "../lib/format.ts";
import { comparisonSlug } from "../lib/slugify.ts";
import {
  COMPARISON_SYSTEM_PROMPT,
  buildComparisonPrompt,
  parseComparisonJson,
} from "./prompts/comparison.ts";
import { checkContent } from "../compliance/checker.ts";
import { checkQualityGate } from "../compliance/quality-gate.ts";

const log = child("content.comparison");

export interface GenerateComparisonOptions {
  productAId: number;
  productBId: number;
  force?: boolean;
}

export interface GenerateComparisonResult {
  contentPageId: number;
  isNew: boolean;
  costUsd: number;
  status: "published" | "rejected" | "pending_review";
}

export async function generateComparisonPage(
  opts: GenerateComparisonOptions,
): Promise<GenerateComparisonResult> {
  // Always order so the slug is deterministic regardless of input order
  const [aId, bId] =
    opts.productAId < opts.productBId
      ? [opts.productAId, opts.productBId]
      : [opts.productBId, opts.productAId];

  const [a, b] = await Promise.all([
    db.query.products.findFirst({
      where: eq(schema.products.id, aId),
      with: { shop: true, reviews: { limit: 3, orderBy: (r, { desc }) => desc(r.capturedAt) } },
    }),
    db.query.products.findFirst({
      where: eq(schema.products.id, bId),
      with: { shop: true, reviews: { limit: 3, orderBy: (r, { desc }) => desc(r.capturedAt) } },
    }),
  ]);
  if (!a || !b) throw new Error(`product ${aId} or ${bId} not found`);

  if (a.flagBlacklisted || b.flagBlacklisted || a.flagRegulated || b.flagRegulated) {
    return {
      contentPageId: -1,
      isNew: false,
      costUsd: 0,
      status: "rejected",
    };
  }

  const slug = comparisonSlug(a.slug, b.slug);

  const existing = await db.query.contentPages.findFirst({
    where: eq(schema.contentPages.slug, slug),
    columns: { id: true, status: true },
  });
  if (existing && !opts.force) {
    return {
      contentPageId: existing.id,
      isNew: false,
      costUsd: 0,
      status: existing.status as GenerateComparisonResult["status"],
    };
  }

  const aspectsFromData = computeRealAspects(a, b);

  const promptResp = await complete(
    buildComparisonPrompt({
      productA: {
        name: a.name,
        priceBaht: bahtFromSatang(a.currentPrice ?? 0),
        rating: a.rating,
        specs: (a.specifications ?? null) as Record<string, string> | null,
      },
      productB: {
        name: b.name,
        priceBaht: bahtFromSatang(b.currentPrice ?? 0),
        rating: b.rating,
        specs: (b.specifications ?? null) as Record<string, string> | null,
      },
    }),
    {
      system: COMPARISON_SYSTEM_PROMPT,
      cacheSystem: true,
      tier: "smart", // comparison needs better judgment
      maxTokens: 1500,
      temperature: 0.5,
    },
  );

  let comparison: ReturnType<typeof parseComparisonJson>;
  try {
    comparison = parseComparisonJson(promptResp.text);
  } catch (err) {
    log.warn({ err: errMsg(err) }, "comparison parse failed");
    throw err;
  }

  // Merge LLM differences with real-data aspects (real-data takes precedence)
  const mergedDifferences = [...aspectsFromData, ...comparison.differences].slice(0, 8);

  const text = [comparison.intro, comparison.verdict, comparison.best_for_a, comparison.best_for_b].join("\n");
  const compliance = await checkContent({ text, isAiGenerated: true, channel: "web" });
  const quality = checkQualityGate({
    text,
    productName: `${a.name} ${b.name}`,
  });

  const status =
    compliance.passed && quality.passed ? ("published" as const) : ("pending_review" as const);

  const contentJson = {
    type: "comparison" as const,
    productA: {
      id: a.id,
      slug: a.slug,
      name: a.name,
      brand: a.brand,
      priceSatang: a.currentPrice,
      rating: a.rating,
      ratingCount: a.ratingCount,
      soldCount: a.soldCount,
      primaryImage: a.primaryImage,
      shop: { name: a.shop?.name, isMall: a.shop?.isMall ?? false },
      externalId: a.externalId,
      shopExternalId: a.shop?.externalId,
    },
    productB: {
      id: b.id,
      slug: b.slug,
      name: b.name,
      brand: b.brand,
      priceSatang: b.currentPrice,
      rating: b.rating,
      ratingCount: b.ratingCount,
      soldCount: b.soldCount,
      primaryImage: b.primaryImage,
      shop: { name: b.shop?.name, isMall: b.shop?.isMall ?? false },
      externalId: b.externalId,
      shopExternalId: b.shop?.externalId,
    },
    intro: compliance.fixedText ?? comparison.intro,
    differences: mergedDifferences,
    bestForA: comparison.best_for_a,
    bestForB: comparison.best_for_b,
    verdict: comparison.verdict,
  };

  const title = `เปรียบเทียบ ${a.name} vs ${b.name}`.slice(0, 60);
  const metaDescription = `${comparison.verdict.slice(0, 130)}...`.slice(0, 155);

  if (existing) {
    await db
      .update(schema.contentPages)
      .set({
        title,
        metaDescription,
        h1: title,
        contentJson,
        status,
        complianceCheckedAt: new Date(),
        complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.contentPages.id, existing.id));
    return { contentPageId: existing.id, isNew: false, costUsd: promptResp.costUsd, status };
  }

  const [row] = await db
    .insert(schema.contentPages)
    .values({
      slug,
      type: "comparison",
      title,
      metaDescription,
      h1: title,
      primaryProductId: a.id,
      relatedProductIds: [b.id],
      categoryId: a.categoryId,
      contentJson,
      keywords: [a.name, b.name, "เปรียบเทียบ"],
      ogImage: a.primaryImage,
      status,
      aiContentPercent: 0.15,
      complianceCheckedAt: new Date(),
      complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning({ id: schema.contentPages.id });

  log.info(
    { aId, bId, slug, status, cost: promptResp.costUsd.toFixed(4) },
    "comparison page generated",
  );
  return { contentPageId: row.id, isNew: true, costUsd: promptResp.costUsd, status };
}

/** Compute factual differences from real product data (no LLM). */
function computeRealAspects(
  a: typeof schema.products.$inferSelect,
  b: typeof schema.products.$inferSelect,
): Array<{ aspect: string; winner: "a" | "b" | "tie"; note: string }> {
  const aspects: Array<{ aspect: string; winner: "a" | "b" | "tie"; note: string }> = [];

  // Price
  if (a.currentPrice && b.currentPrice) {
    const diff = ((b.currentPrice - a.currentPrice) / a.currentPrice) * 100;
    if (Math.abs(diff) >= 10) {
      const winner = diff > 0 ? ("a" as const) : ("b" as const);
      const cheaper = winner === "a" ? a : b;
      aspects.push({
        aspect: "ราคา",
        winner,
        note: `${cheaper.name?.slice(0, 30)} ถูกกว่า ${Math.abs(Math.round(diff))}%`,
      });
    } else {
      aspects.push({ aspect: "ราคา", winner: "tie", note: "ราคาใกล้เคียงกัน" });
    }
  }

  // Rating
  if (a.rating != null && b.rating != null) {
    if (Math.abs(a.rating - b.rating) >= 0.2) {
      aspects.push({
        aspect: "คะแนนผู้ใช้",
        winner: a.rating > b.rating ? "a" : "b",
        note: `${a.rating.toFixed(1)} vs ${b.rating.toFixed(1)}`,
      });
    } else {
      aspects.push({ aspect: "คะแนนผู้ใช้", winner: "tie", note: "ใกล้เคียงกัน" });
    }
  }

  // Sold count (proof)
  if (a.soldCount != null && b.soldCount != null) {
    const ratio = Math.max(a.soldCount, b.soldCount) / Math.max(1, Math.min(a.soldCount, b.soldCount));
    if (ratio >= 2) {
      aspects.push({
        aspect: "ความนิยม",
        winner: a.soldCount > b.soldCount ? "a" : "b",
        note: `ขายได้ ${Math.round(ratio)}x มากกว่า`,
      });
    }
  }

  // Mall vs non-Mall
  // Note: we'd need shop loaded for this; skip if not provided
  return aspects;
}

/**
 * Find product pairs eligible for comparison generation.
 * Returns top-N highest-value pairs that don't have pages yet.
 */
export async function findComparisonCandidates(
  limit = 30,
): Promise<Array<{ aId: number; bId: number }>> {
  const pairs = await db.execute<{ a_id: number; b_id: number }>(sql`
    WITH ranked AS (
      SELECT id, category_id, current_price, final_score,
             ROW_NUMBER() OVER (PARTITION BY category_id ORDER BY final_score DESC NULLS LAST) AS rn
        FROM products
       WHERE is_active = true
         AND flag_blacklisted = false
         AND flag_regulated = false
         AND rating >= 4.2
         -- Apify basic mode rarely populates sold_count; rating_count or
         -- discount also indicate a real, transacting product.
         AND (sold_count >= 100 OR rating_count >= 20 OR discount_percent >= 0.20)
         AND current_price IS NOT NULL
         AND final_score IS NOT NULL
         AND final_score > 0.3
    )
    SELECT a.id AS a_id, b.id AS b_id
      FROM ranked a
      JOIN ranked b
        ON a.category_id = b.category_id
       AND a.id < b.id
       AND a.rn <= 5 AND b.rn <= 5
       -- Similar price (within 30%)
       AND ABS(a.current_price - b.current_price)::float / GREATEST(a.current_price, b.current_price) < 0.30
       -- Don't compare items that are essentially identical
       AND a.current_price <> b.current_price
       AND NOT EXISTS (
         SELECT 1 FROM content_pages cp
          WHERE cp.type = 'comparison'
            AND cp.primary_product_id = a.id
            AND b.id = ANY(SELECT (jsonb_array_elements_text(cp.related_product_ids))::int)
       )
     ORDER BY (a.final_score + b.final_score) DESC
     LIMIT ${limit}
  `);

  return pairs.map((p) => ({ aId: p.a_id, bId: p.b_id }));
}

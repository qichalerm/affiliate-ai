/**
 * Best-of list generator — top 5/10 products in a category.
 *
 * Why these pages convert well:
 *  - Search intent: "best X 2026" is high-volume, high-intent
 *  - Format friendly to AI summary (Google "AI Overview" cites lists)
 *  - One page = many product affiliate links → higher EPV
 *
 * Strategy:
 *  - One list per category × year × variant (best, best-budget, best-premium)
 *  - Pick top N by final_score within category
 *  - LLM writes the intro + per-item one-liner from real data
 *  - Rebuild monthly to keep "2026" rankings fresh
 */

import { db, schema } from "../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import { complete } from "../lib/claude.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { bahtFromSatang } from "../lib/format.ts";
import { slugify } from "../lib/slugify.ts";
import { checkContent } from "../compliance/checker.ts";
import { checkQualityGate } from "../compliance/quality-gate.ts";

const log = child("content.best-of");

export type BestOfVariant = "best" | "best-budget" | "best-premium" | "best-rated";

const VARIANT_LABELS: Record<BestOfVariant, string> = {
  best: "ที่นิยมที่สุด",
  "best-budget": "งบจำกัด",
  "best-premium": "พรีเมียม",
  "best-rated": "คะแนนสูงสุด",
};

export interface GenerateBestOfOptions {
  categoryId: number;
  variant: BestOfVariant;
  topN?: number;
  year?: number;
  force?: boolean;
}

export interface GenerateBestOfResult {
  contentPageId: number;
  isNew: boolean;
  costUsd: number;
  status: "published" | "pending_review" | "rejected";
}

const SYSTEM_PROMPT = `คุณเขียน intro บทความ "Best of" ภาษาไทย สำหรับ aggregator
ข้อกำหนด:
- Intro 80–120 คำ บอกว่าเลือกตามอะไร
- ห้ามขายของ ห้ามคำเกินจริง ("ดีที่สุด", "อันดับ 1")
- ระบุ criteria การ rank (เช่น "ตามยอดขาย × คะแนน × ราคา")
- ตอบ JSON: { "intro": "...", "criteria": "...", "tagline": "..." }`;

interface IntroOutput {
  intro: string;
  criteria: string;
  tagline: string;
}

function parseIntro(raw: string): IntroOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<IntroOutput>;
  return {
    intro: parsed.intro ?? "",
    criteria: parsed.criteria ?? "",
    tagline: parsed.tagline ?? "",
  };
}

export async function generateBestOfPage(
  opts: GenerateBestOfOptions,
): Promise<GenerateBestOfResult> {
  const topN = opts.topN ?? 5;
  const year = opts.year ?? new Date().getFullYear();

  const category = await db.query.categories.findFirst({
    where: eq(schema.categories.id, opts.categoryId),
  });
  if (!category) throw new Error(`category ${opts.categoryId} not found`);

  // Build SQL filter per variant
  let priceFilter = sql`TRUE`;
  let orderBy = sql`final_score DESC NULLS LAST`;
  switch (opts.variant) {
    case "best-budget":
      // Below 25th percentile of category price
      priceFilter = sql`current_price < (
        SELECT percentile_cont(0.30) WITHIN GROUP (ORDER BY current_price)
          FROM products WHERE category_id = ${opts.categoryId} AND current_price > 0
      )`;
      break;
    case "best-premium":
      priceFilter = sql`current_price > (
        SELECT percentile_cont(0.70) WITHIN GROUP (ORDER BY current_price)
          FROM products WHERE category_id = ${opts.categoryId} AND current_price > 0
      )`;
      break;
    case "best-rated":
      orderBy = sql`rating DESC NULLS LAST, rating_count DESC NULLS LAST`;
      break;
  }

  const candidates = await db.execute<{
    id: number;
    name: string;
    brand: string | null;
    current_price: number | null;
    rating: number | null;
    sold_count: number | null;
    primary_image: string | null;
    final_score: number | null;
  }>(sql`
    SELECT id, name, brand, current_price, rating, sold_count, primary_image, final_score
      FROM products
     WHERE category_id = ${opts.categoryId}
       AND is_active = true
       AND flag_blacklisted = false
       AND flag_regulated = false
       AND rating >= 4.0
       -- Same relaxed filter as the category eligibility query above.
       AND (sold_count >= 50 OR rating_count >= 5 OR discount_percent >= 0.10 OR sold_count = 0)
       AND current_price IS NOT NULL
       AND ${priceFilter}
     ORDER BY ${orderBy}
     LIMIT ${topN}
  `);

  if (candidates.length < 3) {
    log.info({ categoryId: opts.categoryId, variant: opts.variant, count: candidates.length }, "not enough candidates; skipping");
    return { contentPageId: -1, isNew: false, costUsd: 0, status: "rejected" };
  }

  const slug = slugify(`${opts.variant}-${category.slug}-${year}`);

  const existing = await db.query.contentPages.findFirst({
    where: eq(schema.contentPages.slug, slug),
    columns: { id: true, status: true },
  });
  if (existing && !opts.force) {
    return {
      contentPageId: existing.id,
      isNew: false,
      costUsd: 0,
      status: existing.status as GenerateBestOfResult["status"],
    };
  }

  const introPrompt = `เขียน intro สำหรับบทความ "${VARIANT_LABELS[opts.variant]} ${category.nameTh} ปี ${year}"
ใช้สินค้า ${candidates.length} ตัวที่อยู่ใน list:
${candidates.map((c, i) => `${i + 1}. ${c.brand ?? ""} ${c.name} — ${bahtFromSatang(c.current_price ?? 0)} บาท, คะแนน ${c.rating}/5, ขาย ${c.sold_count}`).join("\n")}

ตอบเป็น JSON: { intro, criteria, tagline }`;

  let intro: IntroOutput;
  let cost = 0;
  try {
    const resp = await complete(introPrompt, {
      system: SYSTEM_PROMPT,
      cacheSystem: true,
      tier: "fast",
      maxTokens: 600,
      temperature: 0.5,
    });
    cost += resp.costUsd;
    intro = parseIntro(resp.text);
  } catch (err) {
    log.warn({ err: errMsg(err) }, "intro parse failed");
    return { contentPageId: -1, isNew: false, costUsd: cost, status: "rejected" };
  }

  // Compliance + quality
  const compliance = await checkContent({
    text: [intro.intro, intro.criteria, intro.tagline].join("\n"),
    isAiGenerated: true,
    channel: "web",
  });
  const quality = checkQualityGate({
    text: intro.intro,
    productName: category.nameTh,
    styleWindow: { min: 70, max: 130 },
  });

  const status =
    compliance.passed && quality.passed ? ("published" as const) : ("pending_review" as const);

  const contentJson = {
    type: "best_of" as const,
    variant: opts.variant,
    variantLabel: VARIANT_LABELS[opts.variant],
    categoryId: opts.categoryId,
    categoryName: category.nameTh,
    year,
    intro: compliance.fixedText ?? intro.intro,
    criteria: intro.criteria,
    tagline: intro.tagline,
    items: candidates.map((c, idx) => ({
      rank: idx + 1,
      productId: c.id,
      name: c.name,
      brand: c.brand,
      priceSatang: c.current_price,
      rating: c.rating,
      soldCount: c.sold_count,
      primaryImage: c.primary_image,
    })),
  };

  const title = `${VARIANT_LABELS[opts.variant]} ${category.nameTh} ปี ${year}`.slice(0, 60);
  const metaDescription = `รวม ${candidates.length} ${category.nameTh} ${VARIANT_LABELS[opts.variant]} ปี ${year} จัดอันดับจากยอดขาย คะแนน และราคา. ${intro.tagline.slice(0, 60)}`.slice(0, 155);

  if (existing) {
    await db
      .update(schema.contentPages)
      .set({
        title,
        metaDescription,
        h1: title,
        contentJson,
        relatedProductIds: candidates.map((c) => c.id),
        status,
        updatedAt: new Date(),
        complianceCheckedAt: new Date(),
        complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
      })
      .where(eq(schema.contentPages.id, existing.id));
    return { contentPageId: existing.id, isNew: false, costUsd: cost, status };
  }

  const [row] = await db
    .insert(schema.contentPages)
    .values({
      slug,
      type: "best_of",
      title,
      metaDescription,
      h1: title,
      categoryId: opts.categoryId,
      relatedProductIds: candidates.map((c) => c.id),
      contentJson,
      keywords: [
        category.nameTh,
        `${VARIANT_LABELS[opts.variant]} ${category.nameTh}`,
        `${category.nameTh} ${year}`,
      ],
      ogImage: candidates[0]?.primary_image ?? null,
      status,
      aiContentPercent: 0.15,
      complianceCheckedAt: new Date(),
      complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning({ id: schema.contentPages.id });

  log.info(
    { categoryId: opts.categoryId, variant: opts.variant, slug, status, cost: cost.toFixed(4) },
    "best-of page generated",
  );
  return { contentPageId: row.id, isNew: true, costUsd: cost, status };
}

/**
 * Generate best-of pages for all categories with enough product data.
 * Variants: 4 per category × N categories = a lot of pages.
 */
export async function generateAllBestOfPages(opts: { force?: boolean } = {}): Promise<{
  generated: number;
  failed: number;
  totalCost: number;
}> {
  const categories = await db.execute<{ id: number; product_count: number }>(sql`
    SELECT c.id, COUNT(p.id)::int AS product_count
      FROM categories c
      JOIN products p ON p.category_id = c.id
       AND p.is_active = true
       AND p.flag_blacklisted = false
       AND p.rating >= 4.0
       -- Apify basic mode rarely populates sold_count; treat any signal of
       -- traction as eligible (matches the relaxed jobScrapeTrending filter).
       AND (p.sold_count >= 50 OR p.rating_count >= 5 OR p.discount_percent >= 0.10 OR p.sold_count = 0)
     WHERE c.is_active = true
     GROUP BY c.id
    HAVING COUNT(p.id) >= 5
     ORDER BY COUNT(p.id) DESC
  `);

  const variants: BestOfVariant[] = ["best", "best-budget", "best-premium", "best-rated"];
  let generated = 0;
  let failed = 0;
  let totalCost = 0;

  for (const cat of categories) {
    for (const variant of variants) {
      try {
        const r = await generateBestOfPage({
          categoryId: cat.id,
          variant,
          force: opts.force,
        });
        totalCost += r.costUsd;
        if (r.status === "published" || r.status === "pending_review") generated++;
      } catch (err) {
        failed++;
        log.warn({ catId: cat.id, variant, err: errMsg(err) }, "best-of generation failed");
      }
    }
  }

  log.info({ generated, failed, totalCost: totalCost.toFixed(4) }, "all best-of done");
  return { generated, failed, totalCost };
}

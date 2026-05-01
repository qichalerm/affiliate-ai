/**
 * Cross-platform price comparison page generator.
 *
 * Page type: price_compare
 * URL: /ราคา/{slug}
 * Format: "ราคา {product} ที่ Shopee vs Lazada vs ..." — purely price comparison
 *
 * Difference from comparison-generator.ts:
 *   - comparison-generator: A vs B (different products, same category)
 *   - price-compare-generator: SAME product, different platforms (real value)
 *
 * Strategy:
 *  - Pick Shopee products that have ≥1 Lazada match (price_compare table)
 *  - Generate page showing all platforms + lowest current price
 *  - Cheap to produce (1 small LLM call for short intro)
 *  - High SEO value: "{product} ราคา" + "{product} ที่ไหนถูก"
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

const log = child("content.price-compare");

const SYSTEM_PROMPT = `คุณเขียน intro ภาษาไทย 60–90 คำ สำหรับหน้าเปรียบเทียบราคาสินค้าข้ามแพลตฟอร์ม
ข้อกำหนด:
- เน้น "ปัจจุบันราคาที่ไหนถูก" ใช้ตัวเลขจริง
- ไม่ขายของ ไม่คำเกินจริง
- ปิดด้วยข้อแนะนำสั้น เช่น "ตรวจราคาก่อนกดซื้อทุกครั้ง"
- ไม่มี emoji

JSON: { "intro": "...", "best_now": "..." }`;

interface IntroOutput {
  intro: string;
  best_now: string;
}

function parseIntro(raw: string): IntroOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<IntroOutput>;
  return {
    intro: parsed.intro ?? "",
    best_now: parsed.best_now ?? "",
  };
}

export interface GeneratePriceCompareOptions {
  primaryProductId: number;
  force?: boolean;
}

export interface GeneratePriceCompareResult {
  contentPageId: number;
  isNew: boolean;
  costUsd: number;
  status: "published" | "pending_review" | "rejected";
}

export async function generatePriceComparePage(
  opts: GeneratePriceCompareOptions,
): Promise<GeneratePriceCompareResult> {
  const primary = await db.query.products.findFirst({
    where: eq(schema.products.id, opts.primaryProductId),
    with: { shop: true },
  });
  if (!primary) throw new Error(`product ${opts.primaryProductId} not found`);

  if (primary.flagBlacklisted || primary.flagRegulated) {
    return { contentPageId: -1, isNew: false, costUsd: 0, status: "rejected" };
  }

  // Get matched products on other platforms
  const matches = await db.execute<{
    matched_id: number;
    platform: string;
    name: string;
    current_price: number | null;
    rating: number | null;
    external_id: string;
    shop_external_id: string | null;
    primary_image: string | null;
    match_confidence: number;
  }>(sql`
    SELECT pc.matched_product_id AS matched_id,
           p.platform::text AS platform,
           p.name, p.current_price, p.rating,
           p.external_id, s.external_id AS shop_external_id,
           p.primary_image,
           pc.match_confidence
      FROM price_compare pc
      JOIN products p ON p.id = pc.matched_product_id
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE pc.primary_product_id = ${opts.primaryProductId}
       AND pc.match_confidence >= 0.7
       AND p.is_active = true
       AND p.flag_blacklisted = false
     ORDER BY p.current_price ASC NULLS LAST
  `);

  if (matches.length === 0) {
    return { contentPageId: -1, isNew: false, costUsd: 0, status: "rejected" };
  }

  // Build slug — use product slug + "ราคา"
  const slug = slugify(`ราคา-${primary.slug}`);

  const existing = await db.query.contentPages.findFirst({
    where: eq(schema.contentPages.slug, slug),
    columns: { id: true, status: true },
  });
  if (existing && !opts.force) {
    return {
      contentPageId: existing.id,
      isNew: false,
      costUsd: 0,
      status: existing.status as GeneratePriceCompareResult["status"],
    };
  }

  // Compose price line for prompt
  const allPlatforms = [
    {
      platform: primary.platform,
      name: primary.name,
      price: primary.currentPrice,
      shopExternalId: primary.shop?.externalId ?? null,
      externalId: primary.externalId,
      rating: primary.rating,
      primaryImage: primary.primaryImage,
    },
    ...matches.map((m) => ({
      platform: m.platform as typeof primary.platform,
      name: m.name,
      price: m.current_price,
      shopExternalId: m.shop_external_id,
      externalId: m.external_id,
      rating: m.rating,
      primaryImage: m.primary_image,
    })),
  ].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));

  const cheapest = allPlatforms[0]!;

  const promptLines = [
    `สินค้า: ${primary.name}`,
    "",
    "ราคาในแต่ละแพลตฟอร์ม:",
    ...allPlatforms.map(
      (p) =>
        `- ${p.platform}: ${p.price ? bahtFromSatang(p.price).toLocaleString("th-TH") : "?"} บาท`,
    ),
    "",
    `ถูกที่สุดตอนนี้: ${cheapest.platform} ${cheapest.price ? bahtFromSatang(cheapest.price).toLocaleString("th-TH") : "?"} บาท`,
    "",
    "เขียน intro 60–90 คำ + best_now (ประโยคเดียว) ตอบ JSON",
  ];

  let intro: IntroOutput;
  let cost = 0;
  try {
    const resp = await complete(promptLines.join("\n"), {
      system: SYSTEM_PROMPT,
      cacheSystem: true,
      tier: "fast",
      maxTokens: 400,
      temperature: 0.5,
    });
    cost = resp.costUsd;
    intro = parseIntro(resp.text);
  } catch (err) {
    log.warn({ err: errMsg(err) }, "intro parse failed");
    return { contentPageId: -1, isNew: false, costUsd: cost, status: "rejected" };
  }

  // Compliance + quality
  const compliance = await checkContent({
    text: [intro.intro, intro.best_now].join("\n"),
    isAiGenerated: true,
    channel: "web",
  });
  const quality = checkQualityGate({
    text: intro.intro,
    productName: primary.name,
    styleWindow: { min: 50, max: 100 },
  });
  const status =
    compliance.passed && quality.passed ? ("published" as const) : ("pending_review" as const);

  const contentJson = {
    type: "price_compare" as const,
    productName: primary.name,
    brand: primary.brand,
    primaryImage: primary.primaryImage,
    intro: compliance.fixedText ?? intro.intro,
    bestNow: intro.best_now,
    primaryProductId: primary.id,
    primaryProductSlug: primary.slug,
    platforms: allPlatforms,
    cheapest: cheapest.platform,
  };

  const title = `ราคา ${primary.name}`.slice(0, 60);
  const metaDescription = `เปรียบเทียบราคา ${primary.name} ${allPlatforms.length} แพลตฟอร์ม. ${intro.best_now}`.slice(0, 155);

  if (existing) {
    await db
      .update(schema.contentPages)
      .set({
        title,
        metaDescription,
        h1: title,
        contentJson,
        relatedProductIds: matches.map((m) => m.matched_id),
        status,
        complianceCheckedAt: new Date(),
        complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.contentPages.id, existing.id));
    return { contentPageId: existing.id, isNew: false, costUsd: cost, status };
  }

  const [row] = await db
    .insert(schema.contentPages)
    .values({
      slug,
      type: "price_compare",
      title,
      metaDescription,
      h1: title,
      primaryProductId: primary.id,
      relatedProductIds: matches.map((m) => m.matched_id),
      categoryId: primary.categoryId,
      contentJson,
      keywords: [primary.name, `${primary.name} ราคา`, `${primary.name} ที่ไหนถูก`],
      ogImage: primary.primaryImage,
      status,
      aiContentPercent: 0.10, // mostly real prices
      complianceCheckedAt: new Date(),
      complianceFlags: { ...compliance.flags, quality } as Record<string, unknown>,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning({ id: schema.contentPages.id });

  log.info({ slug, status, cost: cost.toFixed(4) }, "price-compare page generated");
  return { contentPageId: row.id, isNew: true, costUsd: cost, status };
}

/**
 * Find products with cross-platform matches that don't yet have a price-compare page.
 * Run as cron after cross-platform matcher.
 */
export async function generateAllPriceComparePages(opts: { limit?: number } = {}): Promise<{
  generated: number;
  failed: number;
  totalCost: number;
}> {
  const limit = opts.limit ?? 50;

  const candidates = await db.execute<{ id: number }>(sql`
    SELECT DISTINCT pc.primary_product_id AS id
      FROM price_compare pc
      JOIN products p ON p.id = pc.primary_product_id
     WHERE pc.match_confidence >= 0.7
       AND p.is_active = true
       AND p.flag_blacklisted = false
       AND p.rating >= 4.0
       AND NOT EXISTS (
         SELECT 1 FROM content_pages cp
          WHERE cp.type = 'price_compare'
            AND cp.primary_product_id = pc.primary_product_id
       )
     LIMIT ${limit}
  `);

  let generated = 0;
  let failed = 0;
  let totalCost = 0;

  for (const c of candidates) {
    try {
      const r = await generatePriceComparePage({ primaryProductId: c.id });
      totalCost += r.costUsd;
      if (r.status === "published" || r.status === "pending_review") generated++;
    } catch (err) {
      failed++;
      log.warn({ id: c.id, err: errMsg(err) }, "price-compare gen failed");
    }
  }

  log.info({ generated, failed, totalCost: totalCost.toFixed(4) }, "all price-compare done");
  return { generated, failed, totalCost };
}

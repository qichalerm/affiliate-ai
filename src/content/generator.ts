/**
 * Content generation orchestrator.
 *
 * Turns a Product → ContentPage with verdict, SEO meta, schema.org JSON-LD.
 * Logs every LLM call to generation_runs for cost tracking.
 */

import { db, schema } from "../lib/db.ts";
import { eq } from "drizzle-orm";
import { complete } from "../lib/claude.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { bahtFromSatang } from "../lib/format.ts";
import {
  VERDICT_SYSTEM_PROMPT,
  buildVerdictPrompt,
  parseVerdictJson,
  type VerdictOutput,
} from "./prompts/verdict.ts";
import {
  SEO_META_SYSTEM,
  buildSeoMetaPrompt,
  parseSeoMetaJson,
  type SeoMetaOutput,
} from "./prompts/seo-meta.ts";
import { checkContent } from "../compliance/checker.ts";

const log = child("content.generator");

export interface GenerateReviewPageOptions {
  productId: number;
  /** Use smart model (Sonnet) for higher quality. Default: fast (Haiku). */
  smart?: boolean;
  /** Force regeneration even if page exists. */
  force?: boolean;
}

export interface GenerateReviewPageResult {
  contentPageId: number;
  isNew: boolean;
  costUsd: number;
  status: "published" | "rejected" | "draft";
  rejectReason?: string;
}

/**
 * Generate a review page for a single product.
 */
export async function generateReviewPage(
  opts: GenerateReviewPageOptions,
): Promise<GenerateReviewPageResult> {
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, opts.productId),
    with: {
      shop: true,
      reviews: {
        limit: 8,
        orderBy: (r, { desc }) => desc(r.capturedAt),
      },
    },
  });
  if (!product) throw new Error(`product ${opts.productId} not found`);

  // Skip blacklisted/regulated
  if (product.flagBlacklisted || product.flagRegulated) {
    return {
      contentPageId: -1,
      isNew: false,
      costUsd: 0,
      status: "rejected",
      rejectReason: `flagged: ${product.flagReason ?? "compliance"}`,
    };
  }

  const slug = product.slug;
  const existingPage = await db.query.contentPages.findFirst({
    where: eq(schema.contentPages.slug, slug),
    columns: { id: true, status: true },
  });
  if (existingPage && !opts.force) {
    log.debug({ slug }, "page exists, skipping");
    return {
      contentPageId: existingPage.id,
      isNew: false,
      costUsd: 0,
      status: existingPage.status as GenerateReviewPageResult["status"],
    };
  }

  // === LLM call 1: verdict ===
  const verdictPromptStart = Date.now();
  const verdictResp = await complete(
    buildVerdictPrompt({
      productName: product.name,
      brand: product.brand,
      priceBaht: bahtFromSatang(product.currentPrice ?? 0),
      rating: product.rating,
      ratingCount: product.ratingCount,
      soldCount: product.soldCount,
      shopName: product.shop?.name,
      isMall: product.shop?.isMall ?? false,
      specs: (product.specifications ?? null) as Record<string, string> | null,
      reviewSnippets: product.reviews.map((r) => r.body),
    }),
    {
      system: VERDICT_SYSTEM_PROMPT,
      cacheSystem: true,
      tier: opts.smart ? "smart" : "fast",
      maxTokens: 1024,
      temperature: 0.4,
    },
  );

  let verdict: VerdictOutput;
  try {
    verdict = parseVerdictJson(verdictResp.text);
  } catch (err) {
    log.warn({ err: errMsg(err), raw: verdictResp.text.slice(0, 200) }, "verdict parse failed");
    await logRun("verdict", null, verdictResp, "failed", errMsg(err), Date.now() - verdictPromptStart);
    throw err;
  }
  await logRun("verdict", null, verdictResp, "success", null, Date.now() - verdictPromptStart);

  // === LLM call 2: SEO meta (small, in fast model) ===
  const seoStart = Date.now();
  const seoResp = await complete(
    buildSeoMetaPrompt({
      productName: product.name,
      brand: product.brand,
      pageType: "review",
      year: new Date().getFullYear(),
    }),
    {
      system: SEO_META_SYSTEM,
      cacheSystem: true,
      tier: "fast",
      maxTokens: 400,
      temperature: 0.5,
    },
  );

  let seo: SeoMetaOutput;
  try {
    seo = parseSeoMetaJson(seoResp.text);
  } catch {
    seo = {
      title: `รีวิว ${product.brand ?? ""} ${product.name}`.trim().slice(0, 60),
      meta_description: verdict.verdict.slice(0, 155),
      h1: product.name,
      primary_keyword: product.name,
      secondary_keywords: [],
    };
  }
  await logRun("seo_meta", null, seoResp, "success", null, Date.now() - seoStart);

  // === Compliance check ===
  const compliance = await checkContent({
    text: [verdict.verdict, ...verdict.pros, ...verdict.cons, seo.title, seo.meta_description].join("\n"),
    isAiGenerated: true,
    productCategory: product.categoryId ? "general" : "general",
  });

  let contentText = verdict.verdict;
  if (compliance.autoFixed) {
    contentText = compliance.fixedText ?? contentText;
  }

  // === Build content JSON for the page renderer ===
  const contentJson = {
    hero: {
      title: seo.h1,
      brand: product.brand,
      priceSatang: product.currentPrice,
      originalPriceSatang: product.originalPrice,
      discountPercent: product.discountPercent,
      rating: product.rating,
      ratingCount: product.ratingCount,
      soldCount: product.soldCount,
      primaryImage: product.primaryImage,
    },
    verdict: {
      text: contentText,
      pros: verdict.pros,
      cons: verdict.cons,
      best_for: verdict.best_for,
      skip_if: verdict.skip_if,
    },
    specs: product.specifications,
    reviewExcerpts: product.reviews.slice(0, 5).map((r) => ({
      rating: r.rating,
      body: r.body,
      reviewer: r.reviewerNameMasked,
    })),
    keywords: [seo.primary_keyword, ...seo.secondary_keywords],
    affiliate: {
      shopId: product.shop?.externalId,
      itemId: product.externalId,
    },
  };

  // === JSON-LD schema for SEO ===
  const schemaJsonLd = buildProductSchema(product, verdict);

  // === Persist ===
  const totalCost = verdictResp.costUsd + seoResp.costUsd;

  const status = compliance.passed ? "published" : "pending_review";

  if (existingPage) {
    await db
      .update(schema.contentPages)
      .set({
        title: seo.title,
        metaDescription: seo.meta_description,
        h1: seo.h1,
        contentJson,
        keywords: contentJson.keywords,
        schemaJsonLd,
        status,
        aiContentPercent: 0.1, // mostly real data, ~10% AI text
        complianceCheckedAt: new Date(),
        complianceFlags: compliance.flags as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(schema.contentPages.id, existingPage.id));
    return {
      contentPageId: existingPage.id,
      isNew: false,
      costUsd: totalCost,
      status: status as "published",
    };
  }

  const [row] = await db
    .insert(schema.contentPages)
    .values({
      slug,
      type: "review",
      title: seo.title,
      metaDescription: seo.meta_description,
      h1: seo.h1,
      primaryProductId: product.id,
      categoryId: product.categoryId,
      contentJson,
      keywords: contentJson.keywords,
      schemaJsonLd,
      ogImage: product.primaryImage,
      status,
      aiContentPercent: 0.1,
      complianceCheckedAt: new Date(),
      complianceFlags: compliance.flags as Record<string, unknown>,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning({ id: schema.contentPages.id });

  log.info(
    { productId: product.id, slug, status, cost: totalCost.toFixed(4) },
    "review page generated",
  );

  return {
    contentPageId: row.id,
    isNew: true,
    costUsd: totalCost,
    status: status as "published",
    rejectReason: compliance.passed ? undefined : compliance.flags.failedChecks.join(","),
  };
}

function buildProductSchema(
  product: typeof schema.products.$inferSelect & {
    shop?: typeof schema.shops.$inferSelect | null;
  },
  verdict: VerdictOutput,
) {
  const priceBaht = bahtFromSatang(product.currentPrice ?? 0);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: product.brand ? { "@type": "Brand", name: product.brand } : undefined,
    image: product.imageUrls ?? [product.primaryImage].filter(Boolean),
    description: verdict.verdict,
    aggregateRating:
      product.rating && product.ratingCount
        ? {
            "@type": "AggregateRating",
            ratingValue: product.rating,
            reviewCount: product.ratingCount,
          }
        : undefined,
    offers: {
      "@type": "Offer",
      priceCurrency: "THB",
      price: priceBaht,
      availability:
        product.stock && product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
      seller: product.shop?.name ? { "@type": "Organization", name: product.shop.name } : undefined,
    },
  };
}

async function logRun(
  kind: string,
  contentPageId: number | null,
  resp: { model: string; inputTokens: number; outputTokens: number; costUsd: number },
  status: "success" | "failed",
  errorMessage: string | null,
  durationMs: number,
) {
  await db.insert(schema.generationRuns).values({
    kind,
    contentPageId: contentPageId ?? undefined,
    model: resp.model,
    promptTokens: resp.inputTokens,
    completionTokens: resp.outputTokens,
    costUsd: resp.costUsd,
    durationMs,
    status,
    errorMessage,
    finishedAt: new Date(),
  });
}

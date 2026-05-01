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
  pickStyleForSlug,
  applyStyleToVerdictPrompt,
  variationHint,
} from "./prompts/verdict-styles.ts";
import {
  FAQ_SYSTEM_PROMPT,
  buildFaqPrompt,
  parseFaqJson,
  faqInputFromProduct,
} from "./prompts/faq.ts";
import { buildReviewPageSchema } from "../seo/schema-builders.ts";
import {
  SEO_META_SYSTEM,
  buildSeoMetaPrompt,
  parseSeoMetaJson,
  type SeoMetaOutput,
} from "./prompts/seo-meta.ts";
import { checkContent } from "../compliance/checker.ts";
import { checkQualityGate } from "../compliance/quality-gate.ts";

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

  // === LLM call 1: verdict (with style variance to avoid AI fingerprint) ===
  const verdictPromptStart = Date.now();
  const style = pickStyleForSlug(slug);
  const basePrompt = buildVerdictPrompt({
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
  });
  const styled = applyStyleToVerdictPrompt(basePrompt, VERDICT_SYSTEM_PROMPT, style);
  const variation = variationHint({ productName: product.name });

  const verdictResp = await complete(
    `${styled.prompt}\n\n[VARIATION]: ${variation}`,
    {
      system: styled.system,
      cacheSystem: true, // base system still cached; suffix is small enough to be re-encoded
      tier: opts.smart ? "smart" : "fast",
      maxTokens: 1024,
      temperature: 0.55, // higher temp for variance
    },
  );

  log.debug({ productId: product.id, style: style.id }, "verdict style picked");

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

  // === LLM call 3: FAQ (4-6 Q&A from real data) ===
  const faqStart = Date.now();
  let faqs: Array<{ question: string; answer: string }> = [];
  let faqCost = 0;
  try {
    const faqResp = await complete(
      buildFaqPrompt(
        faqInputFromProduct(
          product,
          product.reviews.map((r) => r.body),
        ),
      ),
      {
        system: FAQ_SYSTEM_PROMPT,
        cacheSystem: true,
        tier: "fast",
        maxTokens: 1500,
        temperature: 0.6,
      },
    );
    faqCost = faqResp.costUsd;
    faqs = parseFaqJson(faqResp.text).faqs;
    await logRun("faq", null, faqResp, "success", null, Date.now() - faqStart);
  } catch (err) {
    log.warn({ productId: product.id, err: errMsg(err) }, "faq generation failed (non-fatal)");
  }

  // === Compliance check (forbidden words, disclosure) ===
  const compliance = await checkContent({
    text: [verdict.verdict, ...verdict.pros, ...verdict.cons, seo.title, seo.meta_description].join("\n"),
    isAiGenerated: true,
    productCategory: product.categoryId ? "general" : "general",
  });

  let contentText = verdict.verdict;
  if (compliance.autoFixed) {
    contentText = compliance.fixedText ?? contentText;
  }

  // === Quality gate (AI fingerprint, repetition, off-topic) ===
  const quality = checkQualityGate({
    text: contentText,
    productName: product.name,
    brand: product.brand,
    reviewSnippets: product.reviews.map((r) => r.body),
    styleWindow: { min: style.targetWords.min, max: style.targetWords.max },
  });
  if (!quality.passed) {
    log.warn(
      { productId: product.id, score: quality.score, issues: quality.issues.map((i) => i.code) },
      "quality gate failed",
    );
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
    faqs,
    keywords: [seo.primary_keyword, ...seo.secondary_keywords],
    affiliate: {
      shopId: product.shop?.externalId,
      itemId: product.externalId,
    },
  };

  // === JSON-LD schema for SEO (combined: Product + Breadcrumb + FAQPage) ===
  const pageUrl = `https://${process.env.DOMAIN_NAME ?? "yourdomain.com"}/รีวิว/${slug}`;
  const schemaJsonLd = buildReviewPageSchema({
    product: {
      name: product.name,
      brand: product.brand,
      image: product.imageUrls ?? (product.primaryImage ? [product.primaryImage] : []),
      description: contentText,
      rating: product.rating,
      ratingCount: product.ratingCount,
      priceBaht: bahtFromSatang(product.currentPrice ?? 0),
      inStock: (product.stock ?? 1) > 0,
      sellerName: product.shop?.name,
    },
    pageUrl,
    pageName: seo.h1 ?? product.name,
    faq: faqs,
  });

  // === Persist ===
  const totalCost = verdictResp.costUsd + seoResp.costUsd + faqCost;

  // Block on either compliance OR quality gate failure
  const status = compliance.passed && quality.passed ? "published" : "pending_review";

  const combinedFlags = {
    ...compliance.flags,
    quality: {
      score: quality.score,
      issues: quality.issues,
      style: style.id,
    },
  };

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
        complianceFlags: combinedFlags as Record<string, unknown>,
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
      complianceFlags: combinedFlags as Record<string, unknown>,
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

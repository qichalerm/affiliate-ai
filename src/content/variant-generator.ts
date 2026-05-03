/**
 * Variant content generator (Sprint 4 — M4 partial).
 *
 * For each (product × channel), generates N variants with different
 * angles. Each variant passes through the Quality Gate before being
 * saved with gate_approved=true. Failed variants are saved with
 * gate_approved=false + the issues for inspection but won't be picked
 * by M3 (Brain) for publishing.
 *
 * Outputs are persisted to content_variants. M3 will pick which one
 * to publish via Thompson Sampling on bandit_weight.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { complete } from "../lib/claude.ts";
import { runQualityGate } from "../quality/gate.ts";
import { createAffiliateLink } from "../affiliate/link-generator.ts";
import { buildVariantPrompt, type Angle, type ProductInput } from "./variant-prompts.ts";
import type { Platform } from "../quality/platform-rules.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("content.variant-gen");

/** Default angle plan: 3 variants per channel using these angles. */
const DEFAULT_ANGLES: Angle[] = ["deal", "story", "educational"];

interface ParsedVariant {
  caption: string;
  hook: string;
  hashtags: string[];
}

/**
 * Extract first JSON object from Claude response (handles trailing commentary).
 */
function extractJson<T>(text: string): T | null {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "");
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export interface GenerateVariantsOptions {
  productId: number;
  channel: Platform;
  /** Override which angles to generate. Default: ["deal", "story", "educational"]. */
  angles?: Angle[];
  /** If true, generate even if gate-approved variants already exist. */
  force?: boolean;
}

export interface GenerateVariantsResult {
  generated: number;     // total variant rows created
  approved: number;      // how many passed the gate
  failed: number;        // gate-rejected
  skipped: number;       // already had variants and force=false
  totalCostUsd: number;
}

export async function generateVariants(
  opts: GenerateVariantsOptions,
): Promise<GenerateVariantsResult> {
  const angles = opts.angles ?? DEFAULT_ANGLES;
  const result: GenerateVariantsResult = {
    generated: 0,
    approved: 0,
    failed: 0,
    skipped: 0,
    totalCostUsd: 0,
  };

  // Fetch product
  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, opts.productId),
  });
  if (!product) throw new Error(`Product ${opts.productId} not found`);

  // Skip if approved variants already exist (unless force)
  if (!opts.force) {
    const existing = await db.query.contentVariants.findMany({
      where: (v, { and }) =>
        and(
          eq(v.productId, opts.productId),
          eq(v.channel, opts.channel),
          eq(v.gateApproved, true),
          eq(v.isActive, true),
        ),
      limit: 1,
    });
    if (existing.length > 0) {
      log.info(
        { productId: opts.productId, channel: opts.channel },
        "approved variants already exist; skipping (force=false)",
      );
      result.skipped = angles.length;
      return result;
    }
  }

  // Get/create one affiliate link for this (product, channel) combo
  // — all variants share the same shortId (we track variant via DB, not URL)
  const link = await createAffiliateLink({
    productId: product.id,
    channel: opts.channel,
    campaign: `variant_gen_${new Date().toISOString().slice(0, 10)}`,
  });

  // Build product input for prompts (price in BAHT for human-readable display)
  const productInput: ProductInput = {
    name: product.name,
    brand: product.brand,
    priceBaht: (product.currentPrice ?? 0) / 100,
    originalPriceBaht: product.originalPrice ? product.originalPrice / 100 : null,
    discountPercent: product.discountPercent,
    rating: product.rating,
    ratingCount: product.ratingCount,
    description: product.description,
  };

  // Generate each variant
  for (let i = 0; i < angles.length; i++) {
    const angle = angles[i]!;
    const variantCode = String.fromCharCode(65 + i); // A, B, C, ...

    try {
      const { system, user } = buildVariantPrompt({
        product: productInput,
        channel: opts.channel,
        angle,
        shortUrl: link.shortUrl,
        variantCode,
      });

      const llmRes = await complete({
        tier: "fast",
        system,
        prompt: user,
        maxTokens: 600,
        temperature: 0.85, // higher = more variety across A/B/C
        task: `variant_caption.${opts.channel}`,
      });
      result.totalCostUsd += llmRes.costUsd;

      const parsed = extractJson<ParsedVariant>(llmRes.text);
      if (!parsed || !parsed.caption) {
        log.warn(
          { productId: opts.productId, channel: opts.channel, angle, raw: llmRes.text.slice(0, 150) },
          "variant parse failed",
        );
        result.failed++;
        continue;
      }

      // Run through quality gate
      const gateResult = await runQualityGate({
        text: parsed.caption,
        platform: opts.channel,
      });
      result.totalCostUsd += gateResult.llmCostUsd;

      // Persist (regardless of approval — failed ones useful for analysis)
      await db.insert(schema.contentVariants).values({
        productId: product.id,
        channel: opts.channel,
        angle,
        variantCode,
        caption: gateResult.finalText, // may be auto-fixed (e.g. disclosure appended)
        hashtags: parsed.hashtags ?? [],
        hook: parsed.hook ?? null,
        llmModel: llmRes.model,
        gateApproved: gateResult.approved,
        gateIssues: gateResult.approved ? [] : gateResult.issues,
      });

      result.generated++;
      if (gateResult.approved) result.approved++;
      else result.failed++;
    } catch (err) {
      log.error(
        { productId: opts.productId, channel: opts.channel, angle, err: errMsg(err) },
        "variant generation failed",
      );
      result.failed++;
    }
  }

  log.info(
    {
      productId: opts.productId,
      channel: opts.channel,
      generated: result.generated,
      approved: result.approved,
      failed: result.failed,
      costUsd: result.totalCostUsd.toFixed(6),
    },
    "variant gen done",
  );

  return result;
}

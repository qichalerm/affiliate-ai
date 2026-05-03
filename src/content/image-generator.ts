/**
 * Image generator via Replicate (M4 — Sprint 7).
 *
 * Provider: Replicate hosting Flux Schnell / Flux Pro / Flux Dev.
 * Schnell = fastest + cheapest (~$0.003/image), good for bulk variants.
 * Pro = highest quality (~$0.04/image), use sparingly for hero shots.
 *
 * Use cases per channel:
 *   FB / IG image post  → 1080×1080 square (lifestyle or deal banner)
 *   IG Reel cover       → 1080×1920 vertical
 *   Shopee Video cover  → 720×1280 vertical
 *   YT Short cover      → (deferred — channel not in V2 scope)
 *
 * Sprint 7 scope: text-to-image only. Image-to-image (use product photo
 * as reference + add lifestyle context) is a Sprint 11+ enhancement.
 *
 * DRY-RUN: when REPLICATE_API_TOKEN missing or DEBUG_DRY_RUN=true,
 * returns a placeholder URL via picsum.photos (real CDN, deterministic
 * by seed) so downstream pipeline can be tested.
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry, sleep } from "../lib/retry.ts";

const log = child("content.image-gen");

const REPLICATE_BASE = "https://api.replicate.com/v1";

export type ImageStyle =
  | "deal_banner"      // bold price, urgency colors, big text overlay
  | "lifestyle"        // person using product, soft natural light
  | "minimalist"       // clean white bg, product hero
  | "comparison"       // side-by-side (this vs that)
  | "trend_meme";      // tied to current viral aesthetic

export type Aspect = "square" | "vertical" | "horizontal";

const ASPECT_DIMS: Record<Aspect, { width: number; height: number; aspectRatio: string }> = {
  square:     { width: 1080, height: 1080, aspectRatio: "1:1" },
  vertical:   { width: 1080, height: 1920, aspectRatio: "9:16" },
  horizontal: { width: 1920, height: 1080, aspectRatio: "16:9" },
};

const FLUX_MODELS = {
  schnell: "black-forest-labs/flux-schnell",
  dev:     "black-forest-labs/flux-dev",
  pro:     "black-forest-labs/flux-1.1-pro",
} as const;

type FluxTier = keyof typeof FLUX_MODELS;

export interface GenerateImageOptions {
  prompt: string;
  /** Negative prompt — what to avoid (text artifacts, watermarks, etc.) */
  negativePrompt?: string;
  style?: ImageStyle;
  aspect?: Aspect;
  /** Tier: schnell (fast/cheap), dev (balanced), pro (high quality). */
  tier?: FluxTier;
  /** Seed for reproducibility (also used by dry-run placeholder). */
  seed?: number;
  /** Free-form tag for cost tracking. */
  task?: string;
  forceDryRun?: boolean;
}

export interface ImageResult {
  url: string;          // public URL (Replicate CDN or picsum in dry-run)
  width: number;
  height: number;
  costUsd: number;
  durationMs: number;
  dryRun: boolean;
  generationRunId: number;
  seed: number;
}

interface ReplicatePrediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string[] | string;
  error?: string;
  metrics?: { predict_time?: number };
}

const STYLE_PROMPT_PREFIX: Record<ImageStyle, string> = {
  deal_banner: "Bold marketing banner, vibrant colors, eye-catching layout, professional product photography, ",
  lifestyle: "Lifestyle photo of person using product, natural soft lighting, candid feel, magazine quality, ",
  minimalist: "Minimalist product photography, clean white background, studio lighting, sharp focus, ",
  comparison: "Side-by-side product comparison layout, clean composition, equal lighting on both sides, ",
  trend_meme: "Modern trendy aesthetic, social media optimized, bold composition, ",
};

const DEFAULT_NEGATIVE =
  "text, watermark, logo, signature, label, blurry, low quality, distorted, bad anatomy, deformed, ugly";

/**
 * Generate an image. Returns URL + cost.
 * In dry-run, returns a deterministic picsum.photos URL keyed by seed.
 */
export async function generateImage(opts: GenerateImageOptions): Promise<ImageResult> {
  const tier: FluxTier = opts.tier ?? "schnell";
  const aspect: Aspect = opts.aspect ?? "square";
  const dims = ASPECT_DIMS[aspect];
  const seed = opts.seed ?? Math.floor(Math.random() * 1_000_000);

  const dryRun = opts.forceDryRun || env.DEBUG_DRY_RUN || !env.REPLICATE_API_TOKEN;
  const start = Date.now();

  // Build full prompt with style prefix
  const stylePrefix = opts.style ? STYLE_PROMPT_PREFIX[opts.style] : "";
  const fullPrompt = stylePrefix + opts.prompt;

  // Insert generation_runs row first
  const [runRow] = await db
    .insert(schema.generationRuns)
    .values({
      task: opts.task ?? `image_gen.${opts.style ?? "default"}`,
      provider: "replicate",
      model: FLUX_MODELS[tier],
      success: false,  // updated below
      metadata: { aspect, seed, fullPrompt: fullPrompt.slice(0, 500), dryRun },
    })
    .returning({ id: schema.generationRuns.id });
  const generationRunId = runRow!.id;

  if (dryRun) {
    // Picsum placeholder — same seed → same image, useful for dev consistency
    const url = `https://picsum.photos/seed/${seed}/${dims.width}/${dims.height}`;
    log.info(
      { generationRunId, seed, aspect, fullPrompt: fullPrompt.slice(0, 80) },
      "[DRY-RUN] image placeholder",
    );
    await db
      .update(schema.generationRuns)
      .set({
        success: true,
        durationMs: Date.now() - start,
        costUsdMicros: 0,
        metadata: { aspect, seed, fullPrompt: fullPrompt.slice(0, 500), dryRun, placeholderUrl: url },
      })
      .where(sql`id = ${generationRunId}`);
    return {
      url,
      width: dims.width,
      height: dims.height,
      costUsd: 0,
      durationMs: Date.now() - start,
      dryRun: true,
      generationRunId,
      seed,
    };
  }

  // === Live: Replicate API ===
  try {
    const url = await callReplicate({
      model: FLUX_MODELS[tier],
      prompt: fullPrompt,
      negativePrompt: opts.negativePrompt ?? DEFAULT_NEGATIVE,
      aspectRatio: dims.aspectRatio,
      seed,
    });

    // Cost estimate (rough — actual billing varies)
    const costPerImage: Record<FluxTier, number> = {
      schnell: 0.003,
      dev: 0.025,
      pro: 0.04,
    };
    const costUsd = costPerImage[tier];

    await db
      .update(schema.generationRuns)
      .set({
        success: true,
        durationMs: Date.now() - start,
        costUsdMicros: Math.round(costUsd * 1_000_000),
      })
      .where(sql`id = ${generationRunId}`);

    return {
      url,
      width: dims.width,
      height: dims.height,
      costUsd,
      durationMs: Date.now() - start,
      dryRun: false,
      generationRunId,
      seed,
    };
  } catch (err) {
    await db
      .update(schema.generationRuns)
      .set({
        success: false,
        durationMs: Date.now() - start,
        errorMsg: errMsg(err),
      })
      .where(sql`id = ${generationRunId}`);
    throw err;
  }
}

async function callReplicate(opts: {
  model: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  seed: number;
}): Promise<string> {
  // Start prediction
  const start = await retry(async () => {
    const res = await fetch(`${REPLICATE_BASE}/models/${opts.model}/predictions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait=60",  // wait up to 60s for sync response
      },
      body: JSON.stringify({
        input: {
          prompt: opts.prompt,
          aspect_ratio: opts.aspectRatio,
          num_outputs: 1,
          seed: opts.seed,
          go_fast: true,  // schnell only — ignored by other models
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`Replicate ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    return (await res.json()) as ReplicatePrediction;
  });

  // If "wait" succeeded, output is in the response. Otherwise poll.
  let prediction = start;
  while (prediction.status === "starting" || prediction.status === "processing") {
    await sleep(1500);
    const res = await fetch(`${REPLICATE_BASE}/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${env.REPLICATE_API_TOKEN}` },
    });
    prediction = (await res.json()) as ReplicatePrediction;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Replicate prediction ${prediction.status}: ${prediction.error ?? "unknown"}`);
  }

  // Output is array of URLs (one per num_outputs)
  const url = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
  if (!url) throw new Error("Replicate prediction succeeded but no output URL");
  return url;
}

/**
 * Generate an image FOR a specific product — convenience wrapper that
 * builds an appropriate prompt from product fields.
 */
export async function generateProductImage(opts: {
  productId: number;
  style: ImageStyle;
  aspect?: Aspect;
  tier?: FluxTier;
  forceDryRun?: boolean;
}): Promise<ImageResult> {
  const product = await db.query.products.findFirst({
    where: sql`id = ${opts.productId}`,
  });
  if (!product) throw new Error(`Product ${opts.productId} not found`);

  const priceTh = (product.currentPrice ?? 0) / 100;
  const discount = product.discountPercent ? Math.round(product.discountPercent * 100) : 0;

  // Style-specific prompt
  let prompt = "";
  switch (opts.style) {
    case "deal_banner":
      prompt = `${product.brand ?? ""} ${product.name}, "${discount}% OFF" badge, "${priceTh} BAHT" price tag, red and yellow accents, Thai e-commerce style`;
      break;
    case "lifestyle":
      prompt = `Young Thai person enjoying ${product.name}, modern apartment background, golden hour lighting, candid lifestyle photo`;
      break;
    case "minimalist":
      prompt = `${product.brand ?? ""} ${product.name}, isolated on pure white background, subtle drop shadow, premium product hero shot`;
      break;
    case "comparison":
      prompt = `Two ${product.name} side by side, equal studio lighting, comparison photography`;
      break;
    case "trend_meme":
      prompt = `${product.name} in trendy gen-z aesthetic, vibrant gradient background, bold text-friendly composition`;
      break;
  }

  return generateImage({
    prompt,
    style: opts.style,
    aspect: opts.aspect ?? "square",
    tier: opts.tier ?? "schnell",
    task: `product_image.${opts.style}`,
    forceDryRun: opts.forceDryRun,
  });
}

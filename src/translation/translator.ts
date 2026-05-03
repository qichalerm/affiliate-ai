/**
 * Multilingual translator (Sprint 13 — M4+).
 *
 * Translates Thai source product copy into EN, ZH, JA at scrape time.
 * Cached in products.translations JSONB so the web build emits per-language
 * static pages without runtime translation cost or latency.
 *
 * Cost: ~$0.001 per product (Claude Haiku, ~700 tokens for name + short
 * description × 3 target langs). Roughly $0.10 per 100 new products/day.
 *
 * Strategy: only translate fields the web actually shows (name, short
 * description). Long descriptions are scraped but rarely shown verbatim;
 * skip them to save cost.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { complete } from "../lib/claude.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("translation");

export type TargetLang = "en" | "zh" | "ja";
export const TARGET_LANGS: TargetLang[] = ["en", "zh", "ja"];

const LANG_NAMES: Record<TargetLang, string> = {
  en: "English",
  zh: "Simplified Chinese",
  ja: "Japanese",
};

interface TranslationPayload {
  name?: string;
  description?: string;
}

/**
 * Translate a product's name + (optional) short description into one
 * target language. Returns parsed payload or null on parse failure.
 */
async function translateOne(
  sourceName: string,
  sourceDescription: string | null,
  targetLang: TargetLang,
): Promise<{ payload: TranslationPayload; costUsd: number } | null> {
  const langName = LANG_NAMES[targetLang];

  // Truncate description for cost — first 200 chars is plenty for context
  const desc = sourceDescription?.slice(0, 200);

  const system = `You translate Thai e-commerce product copy into ${langName}.

Goals:
- Natural, idiomatic ${langName} (not literal word-for-word)
- Preserve brand names exactly (e.g. "Anker", "Xiaomi", "Apple" stay the same)
- Preserve product model numbers exactly (e.g. "GM2 Pro", "M90")
- Keep technical specs accurate (Bluetooth 5.3, IPX5, etc.)
- Be concise — match length range of source

Reply with strict JSON only:
{
  "name": "the translated product name",
  "description": "the translated short description, or empty string if no input"
}`;

  const user = `Source name (Thai): ${sourceName}
${desc ? `Source description (Thai): ${desc}` : "(no description)"}

Translate to ${langName}.`;

  try {
    const res = await complete({
      tier: "fast",
      system,
      prompt: user,
      maxTokens: 400,
      temperature: 0.3,  // low — translations should be consistent
      task: `translate.${targetLang}`,
    });

    // Extract first JSON object (handles trailing commentary)
    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "");
    const start = cleaned.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let end = -1;
    for (let i = start; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) return null;

    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as TranslationPayload;
    return { payload: parsed, costUsd: res.costUsd };
  } catch (err) {
    log.warn({ targetLang, err: errMsg(err) }, "translation failed");
    return null;
  }
}

export interface TranslateProductOptions {
  productId: number;
  targets?: TargetLang[];
  /** If true, retranslate even if cached translations exist. */
  force?: boolean;
}

export interface TranslateProductResult {
  productId: number;
  langsTranslated: TargetLang[];
  langsSkipped: TargetLang[];
  totalCostUsd: number;
}

/**
 * Translate a product's name + short description into one or more target
 * languages, persisting the result to products.translations JSONB.
 *
 * Skips languages already present unless force=true.
 */
export async function translateProduct(
  opts: TranslateProductOptions,
): Promise<TranslateProductResult> {
  const targets = opts.targets ?? TARGET_LANGS;

  const product = await db.query.products.findFirst({
    where: eq(schema.products.id, opts.productId),
  });
  if (!product) throw new Error(`Product ${opts.productId} not found`);

  const existing: Record<string, TranslationPayload> = (product.translations ?? {}) as Record<string, TranslationPayload>;
  const updated: Record<string, TranslationPayload> = { ...existing };

  const result: TranslateProductResult = {
    productId: opts.productId,
    langsTranslated: [],
    langsSkipped: [],
    totalCostUsd: 0,
  };

  for (const lang of targets) {
    if (existing[lang]?.name && !opts.force) {
      result.langsSkipped.push(lang);
      continue;
    }
    const r = await translateOne(product.name, product.description ?? null, lang);
    if (!r) {
      log.warn({ productId: opts.productId, lang }, "translation skipped (parse failed)");
      result.langsSkipped.push(lang);
      continue;
    }
    updated[lang] = r.payload;
    result.totalCostUsd += r.costUsd;
    result.langsTranslated.push(lang);
  }

  if (result.langsTranslated.length > 0) {
    await db
      .update(schema.products)
      .set({ translations: updated })
      .where(eq(schema.products.id, opts.productId));
  }

  log.info(
    {
      productId: opts.productId,
      translated: result.langsTranslated,
      skipped: result.langsSkipped,
      costUsd: result.totalCostUsd.toFixed(6),
    },
    "translateProduct done",
  );

  return result;
}

/**
 * Batch translate N products that don't yet have translations.
 * Designed for nightly catch-up after scrape.
 */
export async function translateMissingProducts(opts: { limit?: number } = {}): Promise<{
  productsProcessed: number;
  totalLangsTranslated: number;
  totalCostUsd: number;
}> {
  const limit = opts.limit ?? 50;

  // Find products with NO translations or missing target langs
  const candidates = await db.query.products.findMany({
    where: (p, { and, eq, isNull, sql: sqlOp }) =>
      and(
        eq(p.isActive, true),
        eq(p.flagBlacklisted, false),
        sqlOp`(translations IS NULL OR jsonb_typeof(translations) = 'null'
              OR translations -> 'en' IS NULL
              OR translations -> 'zh' IS NULL
              OR translations -> 'ja' IS NULL)`,
      ),
    limit,
    orderBy: (p, { desc }) => desc(p.firstSeenAt),
  });

  log.info({ candidates: candidates.length }, "translateMissingProducts start");

  let totalLangs = 0;
  let totalCost = 0;
  for (const p of candidates) {
    const r = await translateProduct({ productId: p.id });
    totalLangs += r.langsTranslated.length;
    totalCost += r.totalCostUsd;
  }

  log.info(
    {
      productsProcessed: candidates.length,
      totalLangsTranslated: totalLangs,
      totalCostUsd: totalCost.toFixed(6),
    },
    "translateMissingProducts done",
  );

  return {
    productsProcessed: candidates.length,
    totalLangsTranslated: totalLangs,
    totalCostUsd: totalCost,
  };
}

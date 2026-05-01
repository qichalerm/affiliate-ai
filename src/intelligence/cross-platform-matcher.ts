/**
 * Cross-platform product matcher.
 *
 * Goal: detect when "JBL Tune 230NC on Shopee" and "JBL Tune 230NC on Lazada" are
 * the same product, so we can show real cross-platform price comparison.
 *
 * Algorithm (cheap → expensive):
 *   1. Same brand + normalized model number → confidence 0.9
 *   2. Token Jaccard similarity on name (after normalization) ≥ 0.7 → confidence 0.7
 *   3. Image perceptual hash distance (future enhancement) → confidence 0.85
 *   4. LLM verification on near-matches (only when confidence 0.5-0.75) → confidence 0.95
 *
 * Persisted to price_compare table.
 */

import { db, schema } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("cross-platform-matcher");

const STOPWORDS = new Set([
  "ของแท้", "100", "ใหม่", "ส่งฟรี", "พร้อมส่ง", "ราคา", "พิเศษ",
  "the", "and", "for", "with", "new", "original", "official",
  "100%", "+", "-", "/", "|", "(", ")", "[", "]",
]);

/** Normalize product name for matching: lowercase, strip noise, collapse whitespace. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w฀-๿\s]/g, " ") // keep alnum + Thai
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize + remove stopwords + dedupe. */
function tokenize(name: string): Set<string> {
  const tokens = normalize(name).split(/\s+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const t of a) if (b.has(t)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Extract model number candidates from a product name (e.g. "WH-1000XM5", "Tune 230NC"). */
const MODEL_RE = /\b([A-Z]+[\d-]+[A-Z\d]*|[A-Z]\d{3,5}[A-Z]*|\d{2,4}NC|\d{2,4}BT)\b/g;

function extractModels(name: string): Set<string> {
  const out = new Set<string>();
  const matches = name.toUpperCase().match(MODEL_RE);
  if (!matches) return out;
  for (const m of matches) out.add(m);
  return out;
}

interface ProductLite {
  id: number;
  name: string;
  brand: string | null;
  categoryId: number | null;
  currentPrice: number | null;
}

export interface MatchResult {
  primaryProductId: number;
  matchedProductId: number;
  confidence: number;
  method: "model" | "name_jaccard" | "image_hash";
}

/**
 * Find Lazada matches for a Shopee product.
 * Limits search to same category + similar price band to keep it fast.
 */
async function findCandidates(primary: ProductLite): Promise<ProductLite[]> {
  const priceMin = Math.floor((primary.currentPrice ?? 0) * 0.6);
  const priceMax = Math.ceil((primary.currentPrice ?? 0) * 1.7);

  return db.execute<ProductLite>(sql`
    SELECT id, name, brand, category_id AS "categoryId", current_price AS "currentPrice"
      FROM products
     WHERE platform = 'lazada'
       AND is_active = true
       AND flag_blacklisted = false
       AND current_price BETWEEN ${priceMin} AND ${priceMax}
       ${primary.categoryId ? sql`AND (category_id IS NULL OR category_id = ${primary.categoryId})` : sql``}
     LIMIT 200
  `);
}

function scorePair(a: ProductLite, b: ProductLite): MatchResult | null {
  // 1. Same brand + same model
  if (a.brand && b.brand && a.brand.toLowerCase() === b.brand.toLowerCase()) {
    const aModels = extractModels(a.name);
    const bModels = extractModels(b.name);
    for (const m of aModels) {
      if (bModels.has(m)) {
        return {
          primaryProductId: a.id,
          matchedProductId: b.id,
          confidence: 0.9,
          method: "model",
        };
      }
    }
  }

  // 2. Token Jaccard
  const tokensA = tokenize(a.name);
  const tokensB = tokenize(b.name);
  const sim = jaccard(tokensA, tokensB);
  if (sim >= 0.6) {
    return {
      primaryProductId: a.id,
      matchedProductId: b.id,
      confidence: sim,
      method: "name_jaccard",
    };
  }

  return null;
}

export interface MatchOptions {
  /** Only match Shopee products that have score above this. */
  minScore?: number;
  /** Limit Shopee products processed per run. */
  limit?: number;
  /** Min match confidence to persist. */
  minConfidence?: number;
}

export async function runCrossPlatformMatcher(
  opts: MatchOptions = {},
): Promise<{ scanned: number; matched: number }> {
  const minScore = opts.minScore ?? 0.4;
  const limit = opts.limit ?? 500;
  const minConfidence = opts.minConfidence ?? 0.7;

  const primaries = await db.execute<ProductLite>(sql`
    SELECT id, name, brand, category_id AS "categoryId", current_price AS "currentPrice"
      FROM products
     WHERE platform = 'shopee'
       AND is_active = true
       AND flag_blacklisted = false
       AND current_price IS NOT NULL
       AND COALESCE(final_score, 0) >= ${minScore}
     ORDER BY final_score DESC NULLS LAST
     LIMIT ${limit}
  `);

  log.info({ primaries: primaries.length }, "cross-platform matcher start");

  let matched = 0;
  for (const primary of primaries) {
    try {
      const candidates = await findCandidates(primary);
      let bestMatch: MatchResult | null = null;

      for (const candidate of candidates) {
        const result = scorePair(primary, candidate);
        if (!result) continue;
        if (result.confidence < minConfidence) continue;
        if (!bestMatch || result.confidence > bestMatch.confidence) {
          bestMatch = result;
        }
      }

      if (bestMatch) {
        await db
          .insert(schema.priceCompare)
          .values({
            primaryProductId: bestMatch.primaryProductId,
            matchedProductId: bestMatch.matchedProductId,
            matchConfidence: bestMatch.confidence,
            matchMethod: bestMatch.method,
          })
          .onConflictDoUpdate({
            target: [schema.priceCompare.primaryProductId, schema.priceCompare.matchedProductId],
            set: {
              matchConfidence: bestMatch.confidence,
              matchMethod: bestMatch.method,
              capturedAt: new Date(),
            },
          });
        matched++;
      }
    } catch (err) {
      log.warn({ primaryId: primary.id, err: errMsg(err) }, "match attempt failed");
    }
  }

  log.info({ scanned: primaries.length, matched }, "cross-platform matcher done");
  return { scanned: primaries.length, matched };
}

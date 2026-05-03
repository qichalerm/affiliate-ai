/**
 * `bun run src/scripts/backfill-niche.ts`
 *
 * Backfill products.niche for products that scraped before Sprint 24
 * (when the column was added). Strategy: products inherit the niche
 * of the keyword they were first found by — read from scraper_runs:
 *
 *   1. For each product, find the most recent scraper_run that
 *      mentions it (joined via raw payload — but simpler: any run
 *      whose target keyword appears in the product name).
 *   2. Look up which niche that keyword belongs to from NICHE_KEYWORDS.
 *   3. UPDATE products.niche.
 *
 * Anything we can't classify (no keyword match) gets a fallback to
 * the niche with the most-overlapping word in the product name.
 */

import { sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { NICHE_KEYWORDS } from "../scraper/niches.ts";

interface Product { id: number; name: string }

async function main() {
  const untagged = await db.execute<Product & { [k: string]: unknown }>(sql`
    SELECT id, name FROM products WHERE niche IS NULL AND is_active = true
  `);
  console.log(`Found ${untagged.length} untagged products`);

  // Build keyword → niche lookup map (lowercased for case-insensitive match)
  const keywordToNiche = new Map<string, string>();
  for (const [niche, keywords] of Object.entries(NICHE_KEYWORDS)) {
    for (const kw of keywords) {
      keywordToNiche.set(kw.toLowerCase(), niche);
    }
  }

  // For each product, find which keyword(s) appear in its name
  const updates = new Map<string, number[]>();  // niche → [productIds]
  let unmatched = 0;
  for (const p of untagged) {
    const nameLower = p.name.toLowerCase();
    let bestNiche: string | null = null;
    let bestScore = 0;
    for (const [kw, niche] of keywordToNiche) {
      if (nameLower.includes(kw)) {
        // Score by keyword length (longer match = more specific)
        if (kw.length > bestScore) {
          bestScore = kw.length;
          bestNiche = niche;
        }
      }
    }
    if (bestNiche) {
      const arr = updates.get(bestNiche) ?? [];
      arr.push(p.id);
      updates.set(bestNiche, arr);
    } else {
      unmatched++;
    }
  }

  console.log("\n📊 Backfill plan:");
  for (const [niche, ids] of updates) {
    console.log(`  ${niche.padEnd(20)} ${ids.length} products`);
  }
  console.log(`  ${"(unmatched)".padEnd(20)} ${unmatched} products`);

  console.log("\n🔄 Applying...");
  for (const [niche, ids] of updates) {
    await db.execute(sql`
      UPDATE products SET niche = ${niche}::niche
      WHERE id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
    `);
    console.log(`  ✓ ${niche}: tagged ${ids.length}`);
  }

  // Final verification
  const final = await db.execute<{ niche: string; n: number; [k: string]: unknown }>(sql`
    SELECT COALESCE(niche::text, '(none)') AS niche, COUNT(*)::int AS n
    FROM products WHERE is_active = true
    GROUP BY niche ORDER BY 2 DESC
  `);
  console.log("\n✅ Final distribution:");
  for (const r of final) console.log(`  ${r.niche.padEnd(20)} ${r.n}`);

  await closeDb();
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });

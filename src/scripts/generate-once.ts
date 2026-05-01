/**
 * `bun run generate:once -- [productId|max=N]`
 *
 * Generate review pages for products that don't have one yet.
 *   bun run generate:once          → up to 20 pages
 *   bun run generate:once 5        → up to 5 pages
 *   bun run generate:once 123 true → only product 123 (force regen)
 */

import { generateReviewPage } from "../content/generator.ts";
import { db, schema, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";

async function main() {
  const args = process.argv.slice(2);
  const first = args[0];
  const force = args[1] === "true";

  let productIds: number[] = [];

  if (first && /^\d+$/.test(first) && Number(first) > 100) {
    // Looks like a product ID
    productIds = [Number(first)];
  } else {
    const max = first ? Number(first) : 20;
    const candidates = await db.execute<{ id: number; name: string }>(sql`
      SELECT id, name FROM products
       WHERE is_active = true
         AND flag_blacklisted = false
         AND flag_regulated = false
         AND rating >= 4.0
         AND sold_count >= 50
         AND NOT EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = products.id)
       ORDER BY sold_count DESC NULLS LAST
       LIMIT ${max}
    `);
    productIds = candidates.map((c) => c.id);
    console.log(`Found ${productIds.length} products without pages`);
  }

  if (productIds.length === 0) {
    console.log("Nothing to do.");
    await closeDb();
    return;
  }

  let totalCost = 0;
  let success = 0;
  let failed = 0;
  let pending = 0;

  for (const id of productIds) {
    try {
      const result = await generateReviewPage({ productId: id, force });
      totalCost += result.costUsd;
      if (result.status === "published") {
        success++;
        console.log(`✓ #${id} → page ${result.contentPageId} ($${result.costUsd.toFixed(4)})`);
      } else if (result.status === "rejected") {
        failed++;
        console.log(`✗ #${id} REJECTED: ${result.rejectReason}`);
      } else {
        pending++;
        console.log(`⏸ #${id} → page ${result.contentPageId} (compliance review)`);
      }
    } catch (err) {
      failed++;
      console.error(`✗ #${id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log("");
  console.log(`Published: ${success}`);
  console.log(`Pending review: ${pending}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  await closeDb();
}

main().catch((err) => {
  console.error("Generation failed:", err);
  process.exit(1);
});

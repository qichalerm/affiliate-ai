/**
 * `bun run backfill:faq [limit]` — regenerate FAQ + new schema for existing pages.
 *
 * Use after Wave 5 to update existing review pages with FAQs and the new
 * combined schema-builder JSON-LD.
 */

import { db, schema, closeDb } from "../lib/db.ts";
import { sql, eq } from "drizzle-orm";
import { generateReviewPage } from "../content/generator.ts";

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : 100;

  // Find published review pages that have no faqs in contentJson
  const pagesNeedingFaq = await db.execute<{ id: number; primary_product_id: number }>(sql`
    SELECT id, primary_product_id
      FROM content_pages
     WHERE status = 'published'
       AND type = 'review'
       AND primary_product_id IS NOT NULL
       AND (content_json->'faqs' IS NULL
            OR jsonb_array_length(COALESCE(content_json->'faqs', '[]'::jsonb)) = 0)
     ORDER BY revenue_30d_satang DESC NULLS LAST,
              published_at DESC NULLS LAST
     LIMIT ${limit}
  `);

  console.log(`Found ${pagesNeedingFaq.length} pages to backfill\n`);

  let success = 0;
  let failed = 0;
  let totalCost = 0;

  for (const p of pagesNeedingFaq) {
    try {
      const r = await generateReviewPage({
        productId: p.primary_product_id,
        force: true, // overwrite existing
      });
      totalCost += r.costUsd;
      if (r.status === "published") {
        success++;
        console.log(`✓ #${p.primary_product_id} → page ${r.contentPageId} ($${r.costUsd.toFixed(4)})`);
      } else {
        console.log(`⏸ #${p.primary_product_id} → ${r.status}`);
      }
    } catch (err) {
      failed++;
      console.error(`✗ #${p.primary_product_id} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nUpdated: ${success}`);
  console.log(`Failed:  ${failed}`);
  console.log(`Cost:    $${totalCost.toFixed(4)}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

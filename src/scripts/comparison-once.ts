/**
 * `bun run comparison:once [limit]` — generate comparison pages for top eligible pairs.
 */

import { findComparisonCandidates, generateComparisonPage } from "../content/comparison-generator.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : 10;
  const pairs = await findComparisonCandidates(limit);
  console.log(`Found ${pairs.length} eligible pairs.\n`);

  let success = 0;
  let failed = 0;
  let totalCost = 0;

  for (const { aId, bId } of pairs) {
    try {
      const r = await generateComparisonPage({ productAId: aId, productBId: bId });
      totalCost += r.costUsd;
      if (r.status === "published") {
        success++;
        console.log(`✓ A=${aId} vs B=${bId} → page ${r.contentPageId} ($${r.costUsd.toFixed(4)})`);
      } else {
        console.log(`⏸ A=${aId} vs B=${bId} → ${r.status}`);
      }
    } catch (err) {
      failed++;
      console.error(`✗ A=${aId} vs B=${bId} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nPublished: ${success}`);
  console.log(`Failed:    ${failed}`);
  console.log(`Cost:      $${totalCost.toFixed(4)}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

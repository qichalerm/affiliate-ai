/**
 * `bun run price-compare:once` — generate price-compare pages once.
 */

import { generateAllPriceComparePages } from "../content/price-compare-generator.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : 30;
  console.log(`Generating price-compare pages (limit ${limit})...\n`);
  const r = await generateAllPriceComparePages({ limit });
  console.log("");
  console.log(`Generated: ${r.generated}`);
  console.log(`Failed:    ${r.failed}`);
  console.log(`Cost:      $${r.totalCost.toFixed(4)}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

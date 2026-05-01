/**
 * `bun run bestof:once` — generate best-of pages for all eligible categories.
 */

import { generateAllBestOfPages } from "../content/best-of-generator.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const force = process.argv[2] === "true";
  console.log(`Generating best-of pages${force ? " (FORCE)" : ""}...\n`);
  const result = await generateAllBestOfPages({ force });
  console.log("");
  console.log(`Generated: ${result.generated}`);
  console.log(`Failed:    ${result.failed}`);
  console.log(`Cost:      $${result.totalCost.toFixed(4)}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

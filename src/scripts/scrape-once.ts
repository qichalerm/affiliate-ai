/**
 * `bun run src/scripts/scrape-once.ts [keyword] [maxProducts]`
 *
 * Manual scrape trigger — useful for first-time data population
 * or to test a specific keyword.
 *
 * If keyword omitted, uses pickKeywords({ count: 1 }) to pick one
 * random keyword across all niches.
 */

import { runShopeeScrape } from "../scraper/shopee/runner.ts";
import { pickKeywords } from "../scraper/niches.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const cliKeyword = process.argv[2];
  const cliMax = process.argv[3] ? Number.parseInt(process.argv[3], 10) : undefined;

  let keyword: string;
  let niche;
  if (cliKeyword) {
    keyword = cliKeyword;
  } else {
    const pick = pickKeywords({ count: 1 })[0]!;
    keyword = pick.keyword;
    niche = pick.niche;
  }

  console.log(`\n🛒 Scraping "${keyword}" (max ${cliMax ?? "default"} products)...\n`);

  const result = await runShopeeScrape({ keyword, niche, maxProducts: cliMax });

  console.log("\n📊 Result:");
  console.log(`   Run ID:        ${result.runId}`);
  console.log(`   Attempted:     ${result.attempted}`);
  console.log(`   Succeeded:     ${result.succeeded}`);
  console.log(`   Failed:        ${result.failed}`);
  console.log(`   New products:  ${result.newProducts}`);
  console.log(`   Price changes: ${result.priceChanges}`);
  console.log(`   Cost (USD):    $${result.costUsd.toFixed(4)}`);
  if (result.apifyRunId) console.log(`   Apify run:     ${result.apifyRunId}`);
  if (result.skippedReason) console.log(`   ⚠ Skipped:     ${result.skippedReason}`);

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("scrape failed:", err);
  process.exit(1);
});

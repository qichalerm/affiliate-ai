/**
 * `bun run scrape:once -- [keyword]`
 *
 * One-off scrape for development/debugging.
 * Examples:
 *   bun run scrape:once หูฟัง
 *   bun run scrape:once -- "เมาส์ gaming" 30
 */

import { runShopeeScrape } from "../scraper/shopee/runner.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const args = process.argv.slice(2);
  const keyword = args[0] ?? "หูฟังบลูทูธ";
  const maxProducts = args[1] ? Number(args[1]) : 20;

  console.log(`Scraping "${keyword}" (max ${maxProducts} products)...\n`);

  const start = Date.now();
  const result = await runShopeeScrape({
    keyword,
    maxProducts,
    fetchDetails: true,
    reviewsPerProduct: 10,
  });

  console.log("\n=== Results ===");
  console.log(`Run ID:    ${result.scraperRunId}`);
  console.log(`Attempted: ${result.itemsAttempted}`);
  console.log(`Succeeded: ${result.itemsSucceeded}`);
  console.log(`Failed:    ${result.itemsFailed}`);
  console.log(`Duration:  ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Total:     ${((Date.now() - start) / 1000).toFixed(1)}s`);

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("Scrape failed:", err);
  process.exit(1);
});

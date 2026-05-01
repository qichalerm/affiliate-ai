/**
 * `bun run scrape:lazada [keyword] [maxPages]`
 */

import { runLazadaScrape } from "../scraper/lazada/runner.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const args = process.argv.slice(2);
  const keyword = args[0] ?? "wireless earbuds";
  const maxPages = args[1] ? Number(args[1]) : 2;

  console.log(`Lazada scrape: "${keyword}" (${maxPages} pages)\n`);
  const r = await runLazadaScrape({ keyword, maxPages, maxProducts: 30 });
  console.log("");
  console.log(`Run ID:    ${r.scraperRunId}`);
  console.log(`Attempted: ${r.itemsAttempted}`);
  console.log(`Succeeded: ${r.itemsSucceeded}`);
  console.log(`Failed:    ${r.itemsFailed}`);
  console.log(`Duration:  ${(r.durationMs / 1000).toFixed(1)}s`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

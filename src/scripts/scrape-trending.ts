/**
 * `bun run scrape:trending` — manually trigger the scheduled trending-scrape job.
 * Useful for first-time data population.
 */

import { jobScrapeTrending } from "../scheduler/jobs.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  console.log("Starting trending-scrape job...\n");
  await jobScrapeTrending();
  console.log("\n✓ Done");
  await closeDb();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});

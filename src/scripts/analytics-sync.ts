/**
 * `bun run analytics:sync` — pull GSC + CF Analytics + Short.io once.
 */

import { runAnalyticsIngest } from "../analytics/runner.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  console.log("Running analytics ingestion...\n");
  const r = await runAnalyticsIngest();
  console.log("");
  console.log("GSC:    ", r.gsc);
  console.log("CF:     ", r.cf);
  console.log("Shortio:", r.shortio);
  console.log("Scored: ", r.scored);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

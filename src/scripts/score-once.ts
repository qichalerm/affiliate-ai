/**
 * `bun run score:once [limit]` — score products once, then exit.
 * Useful for backfilling scores after a big scrape.
 */

import { runScoring } from "../intelligence/score-runner.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : undefined;
  console.log("Scoring products...\n");
  const r = await runScoring({ limit, staleAfterMin: 0 });
  console.log("");
  console.log(`Scored:   ${r.scored}`);
  console.log(`Killed:   ${r.killed}`);
  console.log(`Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  await closeDb();
}

main().catch((err) => {
  console.error("Score run failed:", err);
  process.exit(1);
});

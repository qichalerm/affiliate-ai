/**
 * `bun run match:products` — run cross-platform matcher once.
 */

import { runCrossPlatformMatcher } from "../intelligence/cross-platform-matcher.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  const limit = process.argv[2] ? Number(process.argv[2]) : 500;
  console.log(`Running cross-platform matcher (limit ${limit})...\n`);
  const r = await runCrossPlatformMatcher({ limit });
  console.log("");
  console.log(`Scanned: ${r.scanned}`);
  console.log(`Matched: ${r.matched}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

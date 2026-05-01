/**
 * `bun run links:refresh` — recompute internal links across all published pages.
 */

import { refreshAllInternalLinks } from "../seo/internal-linker.ts";
import { closeDb } from "../lib/db.ts";

async function main() {
  console.log("Refreshing internal links...\n");
  const r = await refreshAllInternalLinks();
  console.log("");
  console.log(`Updated: ${r.updated}`);
  console.log(`Failed:  ${r.failed}`);
  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * `bun run src/scripts/build-site.ts`
 *
 * Build the static site once and exit. Use SITE_OUT_DIR / SITE_DOMAIN /
 * SITE_NAME env vars to override defaults.
 */

import { buildSite } from "../web/site-builder.ts";
import { closeDb } from "../lib/db.ts";

const result = await buildSite();
console.log("\n✓ Built", result.pagesWritten, "pages from", result.productsRendered, "products in", result.durationMs, "ms");
console.log("  → output:", result.outDir);
await closeDb();
process.exit(0);

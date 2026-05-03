/**
 * `bun run src/scripts/deploy-site.ts`
 *
 * One-shot: build the static site, then push it to Cloudflare Pages.
 * Equivalent to running `build:site` then `wrangler pages deploy` but
 * shares the BuildOptions and reads the deployment URL back for logging.
 */

import { buildSite } from "../web/site-builder.ts";
import { deployToCloudflarePages } from "../web/deploy-cloudflare.ts";
import { closeDb } from "../lib/db.ts";

const buildResult = await buildSite();
console.log(`✓ Built ${buildResult.pagesWritten} pages from ${buildResult.productsRendered} products in ${buildResult.durationMs}ms`);

const deployResult = await deployToCloudflarePages({
  outDir: buildResult.outDir,
  commitMessage: `Auto-deploy: ${buildResult.productsRendered} products, ${buildResult.pagesWritten} pages`,
});

console.log(`✓ Deployed in ${deployResult.durationMs}ms`);
console.log(`  → preview:    ${deployResult.url}`);
if (deployResult.aliasUrl) console.log(`  → alias:      ${deployResult.aliasUrl}`);

await closeDb();
process.exit(0);

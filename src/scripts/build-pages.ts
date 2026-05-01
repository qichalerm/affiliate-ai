/**
 * `bun run build:pages` — invoke Astro to build the static site,
 * then optionally trigger Cloudflare Pages deploy.
 *
 * Sequence:
 *   1. cd src/web && astro build
 *   2. (if CLOUDFLARE_API_TOKEN set) trigger deploy hook
 *   3. (if GOOGLE_SEARCH_CONSOLE_PROPERTY set) ping Indexing API for new URLs
 */

import { spawn } from "node:child_process";
import { env, can } from "../lib/env.ts";
import { closeDb } from "../lib/db.ts";

function runCmd(cmd: string, args: string[], cwd?: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: "inherit", env: process.env });
    proc.on("exit", (code) => resolve(code ?? 0));
    proc.on("error", reject);
  });
}

async function main() {
  console.log("=== Building Astro static site ===\n");
  const buildCode = await runCmd("bun", ["run", "build"], "src/web");
  if (buildCode !== 0) {
    console.error(`Astro build failed with code ${buildCode}`);
    process.exit(buildCode);
  }
  console.log("\n✓ Astro build done\n");

  // Cloudflare Pages deploy
  if (can.deployCloudflare() && env.CLOUDFLARE_PAGES_PROJECT) {
    console.log("=== Deploying to Cloudflare Pages ===\n");
    const deployCode = await runCmd(
      "bunx",
      [
        "wrangler",
        "pages",
        "deploy",
        "src/web/dist",
        `--project-name=${env.CLOUDFLARE_PAGES_PROJECT}`,
      ],
    );
    if (deployCode !== 0) {
      console.error(`Cloudflare deploy failed with code ${deployCode}`);
    } else {
      console.log("\n✓ Deploy done");
    }
  } else {
    console.log("Skip deploy: CLOUDFLARE_API_TOKEN not configured");
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("build-pages failed:", err);
  process.exit(1);
});

/**
 * Cloudflare Pages deployer — Sprint 21.
 *
 * Wraps `wrangler pages deploy` to push the dist/ tree to Cloudflare
 * Pages. Why wrangler instead of the raw Direct Upload API:
 *   - Manifest hashing, missing-asset diff, chunked upload, retries —
 *     wrangler does all of this. Re-implementing in 200 lines would
 *     duplicate ~2000 lines of edge cases.
 *   - Wrangler is the official, supported path; CF API surface for
 *     Pages is intentionally semi-private and changes without notice.
 *   - Bunx caches wrangler after first run, so subsequent deploys are
 *     fast (~5s) and we don't need a permanent dev dependency.
 *
 * Env required (validated by env.ts):
 *   CLOUDFLARE_API_TOKEN
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_PAGES_PROJECT
 *
 * Returns the deployment URL on success. Throws on any non-zero exit.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";

const log = child("web.deploy-cloudflare");

export interface DeployOptions {
  /** dist directory to upload. Default: env.SITE_OUT_DIR */
  outDir?: string;
  /** Pages project name. Default: env.CLOUDFLARE_PAGES_PROJECT */
  projectName?: string;
  /** Branch label for this deployment (only "production" maps to custom domains). */
  branch?: string;
  /** Free-form commit message for the deployment. */
  commitMessage?: string;
}

export interface DeployResult {
  url: string;            // <commit-hash>.<project>.pages.dev
  aliasUrl?: string;      // production alias (e.g. main.<project>.pages.dev)
  durationMs: number;
}

export async function deployToCloudflarePages(opts: DeployOptions = {}): Promise<DeployResult> {
  if (!can.deployCloudflare()) {
    throw new Error(
      "Cloudflare deploy not configured: set CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID",
    );
  }

  const outDir = opts.outDir ?? env.SITE_OUT_DIR;
  const projectName = opts.projectName ?? env.CLOUDFLARE_PAGES_PROJECT;
  const branch = opts.branch ?? "main";  // "main" gets routed to custom domain
  const commitMessage = opts.commitMessage ?? `affiliate-ai auto-deploy ${new Date().toISOString()}`;

  if (!existsSync(outDir)) {
    throw new Error(`outDir does not exist: ${outDir} — run buildSite() first`);
  }

  log.info({ outDir, projectName, branch }, "cloudflare pages deploy start");
  const start = Date.now();

  const args = [
    "wrangler@latest",
    "pages",
    "deploy",
    outDir,
    `--project-name=${projectName}`,
    `--branch=${branch}`,
    `--commit-message=${commitMessage}`,
  ];

  const stdout = await runBunx(args, {
    CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN!,
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID!,
  });

  // Parse the deployment URL from wrangler's output.
  // Successful output contains lines like:
  //   ✨ Deployment complete! Take a peek over at https://abc123.<your-project>.pages.dev
  //   ✨ Deployment alias URL: https://main.<your-project>.pages.dev
  const urlMatch = stdout.match(/https:\/\/([a-z0-9-]+\.)?[a-z0-9-]+\.pages\.dev/g);
  const url = urlMatch?.[0] ?? "(unknown)";
  const aliasUrl = urlMatch?.find((u) => u.includes(`${branch}.`));

  const result: DeployResult = {
    url,
    aliasUrl,
    durationMs: Date.now() - start,
  };

  log.info(result, "cloudflare pages deploy done");
  return result;
}

function runBunx(
  args: string[],
  extraEnv: Record<string, string>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // systemd's default PATH doesn't include /root/.bun/bin, so spawning
    // "bunx" by name fails with ENOENT under affiliate-ai-scheduler.service.
    // Resolve to absolute path: try $BUN_INSTALL/bin/bunx, fall back to
    // common locations, and only then spawn by name.
    const bunxPath = (() => {
      const candidates = [
        process.env.BUN_INSTALL ? `${process.env.BUN_INSTALL}/bin/bunx` : null,
        "/root/.bun/bin/bunx",
        "/usr/local/bin/bunx",
      ].filter((x): x is string => Boolean(x));
      for (const p of candidates) {
        try { if (require("node:fs").existsSync(p)) return p; } catch {}
      }
      return "bunx";  // last resort — relies on PATH
    })();

    const proc = spawn(bunxPath, args, {
      env: {
        ...process.env,
        ...extraEnv,
        PATH: `/root/.bun/bin:${process.env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let out = "";
    let err = "";
    proc.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      out += s;
      // Stream wrangler progress to our logger so the operator can see
      // upload-by-upload progress without manually tailing files.
      for (const line of s.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) log.info({ wrangler: trimmed }, "wrangler stdout");
      }
    });
    proc.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      err += s;
      for (const line of s.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length > 0) log.warn({ wrangler: trimmed }, "wrangler stderr");
      }
    });

    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`bunx ${args.join(" ")} exited ${code}\n${err || out}`));
    });
    proc.on("error", reject);
  });
}

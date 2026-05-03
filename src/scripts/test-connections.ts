/**
 * `bun run test-connections` — verify all configured services are reachable.
 */

import { pingDb, closeDb } from "../lib/db.ts";
import { complete } from "../lib/claude.ts";
import { can, env } from "../lib/env.ts";
import { errMsg } from "../lib/retry.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

interface TestResult {
  service: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
}

async function timed(service: string, fn: () => Promise<{ ok: boolean; detail?: string }>): Promise<TestResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return { service, ok: r.ok, detail: r.detail, durationMs: Date.now() - start };
  } catch (err) {
    return { service, ok: false, detail: errMsg(err), durationMs: Date.now() - start };
  }
}

const tests: Array<() => Promise<TestResult>> = [
  () =>
    timed("Postgres (Neon)", async () => {
      const ok = await pingDb();
      return { ok, detail: ok ? "ping OK" : "ping failed — check DATABASE_URL" };
    }),

  () =>
    timed("Anthropic (Claude)", async () => {
      if (!can.generateContent()) return { ok: false, detail: "ANTHROPIC_API_KEY not set" };
      const r = await complete("ตอบสั้นๆ: 1+1 ?", { tier: "fast", maxTokens: 20 });
      return { ok: r.text.length > 0, detail: `model=${r.model}, cost=$${r.costUsd.toFixed(5)}` };
    }),

  () =>
    timed("Shopee public API", async () => {
      const { searchByKeyword } = await import("../scraper/shopee/client.ts");
      const r = await searchByKeyword("หูฟัง", { limit: 5 });
      const count = r.items?.length ?? 0;
      return { ok: count > 0, detail: `${count} items returned` };
    }),
];

async function main() {
  console.log("Testing service connections...\n");
  const results = await Promise.all(tests.map((t) => t()));
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
    console.log(
      `${icon} ${r.service.padEnd(28)} ${r.durationMs.toString().padStart(5)}ms  ${r.detail ?? ""}`,
    );
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(
    `\n${failed === 0 ? GREEN : YELLOW}${results.length - failed}/${results.length} services reachable${RESET}`,
  );

  await closeDb();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});

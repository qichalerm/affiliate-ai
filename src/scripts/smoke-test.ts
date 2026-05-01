/**
 * `bun run smoke` — end-to-end smoke test of critical paths.
 *
 * Run after deploys or major changes. Each test is fast (< 5s) and read-only
 * where possible. Exits with code 1 if any critical test fails.
 *
 * Tests:
 *   - DB connection + schema version check
 *   - Anthropic API reachable (1 token call)
 *   - Telegram bot reachable (no message sent)
 *   - Shopee public API responds (1 search)
 *   - Cloudflare Pages deploy URL responds (HEAD)
 *   - Sitemap exists if running on production
 *   - Compliance check works (forbidden word detection)
 *   - URL builder produces valid URLs for each platform
 *   - Quality gate works
 */

import { db, pingDb, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { complete } from "../lib/claude.ts";
import { pingBot } from "../lib/telegram.ts";
import { searchByKeyword } from "../scraper/shopee/client.ts";
import { env, can } from "../lib/env.ts";
import { scanForbidden } from "../compliance/forbidden-words.ts";
import { checkQualityGate } from "../compliance/quality-gate.ts";
import { buildAffiliateUrl } from "../adapters/affiliate-links.ts";
import { errMsg } from "../lib/retry.ts";

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

interface TestResult {
  name: string;
  ok: boolean;
  detail?: string;
  durationMs: number;
  critical: boolean;
}

async function runTest(
  name: string,
  fn: () => Promise<{ ok: boolean; detail?: string }>,
  critical = true,
): Promise<TestResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return { name, ...r, durationMs: Date.now() - start, critical };
  } catch (err) {
    return {
      name,
      ok: false,
      detail: errMsg(err),
      durationMs: Date.now() - start,
      critical,
    };
  }
}

async function main() {
  const results: TestResult[] = [];

  console.log("Running smoke tests...\n");

  // 1. DB connection
  results.push(
    await runTest("db.ping", async () => {
      const ok = await pingDb();
      return { ok, detail: ok ? undefined : "ping failed" };
    }),
  );

  // 2. Schema version (table count)
  results.push(
    await runTest(
      "db.schema",
      async () => {
        const rows = await db.execute<{ count: number }>(sql`
          SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'
        `);
        const count = rows[0]?.count ?? 0;
        return {
          ok: count >= 18,
          detail: `${count} tables (expect ≥ 18)`,
        };
      },
      true,
    ),
  );

  // 3. Anthropic API
  results.push(
    await runTest(
      "anthropic.api",
      async () => {
        if (!can.generateContent()) return { ok: false, detail: "no API key" };
        const r = await complete("ตอบสั้นๆ: 1+1?", { maxTokens: 16 });
        return { ok: r.text.length > 0, detail: `model=${r.model}` };
      },
      false,
    ),
  );

  // 4. Telegram bot
  results.push(
    await runTest(
      "telegram.bot",
      async () => {
        if (!can.alertTelegram()) return { ok: false, detail: "no token" };
        const r = await pingBot();
        return { ok: r.ok, detail: r.ok ? `@${r.me}` : r.error };
      },
      false,
    ),
  );

  // 5. Shopee public API
  results.push(
    await runTest(
      "shopee.search",
      async () => {
        const r = await searchByKeyword("หูฟัง", { limit: 5 });
        const count = r.items?.length ?? 0;
        return { ok: count > 0, detail: `${count} items` };
      },
      true,
    ),
  );

  // 6. Compliance — forbidden word detection
  results.push(
    await runTest(
      "compliance.forbidden",
      async () => {
        const r = scanForbidden("สินค้านี้สามารถรักษามะเร็งได้");
        return {
          ok: !r.passed && r.blocked.length > 0,
          detail: `blocked ${r.blocked.length} (expect ≥ 1)`,
        };
      },
      true,
    ),
  );

  // 7. Quality gate
  results.push(
    await runTest(
      "compliance.quality_gate",
      async () => {
        const r = checkQualityGate({
          text: "ในยุคปัจจุบัน สินค้าไอที เป็นที่นิยม สำหรับใช้งานจริง",
          productName: "หูฟังบลูทูธ XYZ",
        });
        return {
          ok: !r.passed,
          detail: `flagged ${r.issues.length} issues (expect ≥ 1: AI fingerprint)`,
        };
      },
      true,
    ),
  );

  // 8. URL builders for each platform
  results.push(
    await runTest(
      "adapters.urls",
      async () => {
        const platforms = ["shopee", "lazada", "tiktok_shop", "robinson"] as const;
        const built = platforms.map((p) =>
          buildAffiliateUrl({
            platform: p,
            externalId: "12345",
            shopExternalId: "67890",
            subId: "test",
          }),
        );
        const valid = built.filter((u) => u !== null && u.startsWith("https://"));
        return {
          ok: valid.length === platforms.length,
          detail: `${valid.length}/${platforms.length} platforms`,
        };
      },
      true,
    ),
  );

  // 9. Recent ingestion (warn-only, not critical)
  results.push(
    await runTest(
      "ingestion.recent",
      async () => {
        const rows = await db.execute<{ last_run: Date | null }>(sql`
          SELECT MAX(started_at) AS last_run FROM scraper_runs WHERE status = 'success'
        `);
        const last = rows[0]?.last_run;
        if (!last) return { ok: false, detail: "no successful scrape ever" };
        const hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
        return {
          ok: hours < 24,
          detail: `last ${hours.toFixed(1)}h ago`,
        };
      },
      false,
    ),
  );

  // 10. Public site reachable (HEAD)
  results.push(
    await runTest(
      "site.reachable",
      async () => {
        if (!env.DOMAIN_NAME || env.DOMAIN_NAME === "yourdomain.com") {
          return { ok: false, detail: "DOMAIN_NAME not set" };
        }
        const url = `https://${env.DOMAIN_NAME}/robots.txt`;
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const res = await fetch(url, { method: "HEAD", signal: ctrl.signal });
          return { ok: res.ok, detail: `${url} → ${res.status}` };
        } finally {
          clearTimeout(timer);
        }
      },
      false,
    ),
  );

  // Print results
  console.log("");
  let passed = 0;
  let failed = 0;
  let criticalFailed = 0;
  for (const r of results) {
    const icon = r.ok ? `${GREEN}✓${RESET}` : r.critical ? `${RED}✗${RESET}` : `${YELLOW}·${RESET}`;
    const tag = r.critical ? "" : `${YELLOW}[opt]${RESET} `;
    console.log(
      `${icon} ${tag}${r.name.padEnd(28)} ${r.durationMs.toString().padStart(5)}ms  ${r.detail ?? ""}`,
    );
    if (r.ok) passed++;
    else {
      failed++;
      if (r.critical) criticalFailed++;
    }
  }

  console.log("");
  console.log(
    `${passed}/${results.length} passed, ${criticalFailed} critical failures`,
  );

  await closeDb();
  process.exit(criticalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Smoke test runner crashed:", err);
  process.exit(2);
});

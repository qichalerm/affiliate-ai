/**
 * `bun run src/scripts/test-source-health.ts`
 *
 * Inject synthetic scraper_runs that look like degradation, run the
 * health check, and verify alerts fire with the right codes.
 *
 * Cleans up its synthetic rows + alerts at the end so the prod tables
 * stay tidy.
 */

import { sql, and, eq, isNull } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { runSourceHealthCheck, clearSourceHealthAlerts } from "../monitoring/source-health.ts";

// Use an isolated scraper name so test data never collides with prod runs
const SCRAPER = "shopee_apify_smoketest";

async function main() {
  console.log("🧪 Source Health smoke test\n");

  // Wipe any open SOURCE_HEALTH alerts for this scraper so cooldown
  // doesn't suppress this run
  await db.delete(schema.alerts)
    .where(sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`);

  // ── Scenario A: STALE — last success > 6h ago ────────────────────
  console.log("Scenario A: STALE (no success in 8h)");
  // Insert a single failed run from 2h ago + an old success from 8h ago
  await db.insert(schema.scraperRuns).values({
    scraper: SCRAPER,
    target: "test_stale_old",
    status: "success",
    itemsSucceeded: 10,
    costUsdMicros: 5_000,  // baseline cost
    startedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    finishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000 + 30_000),
  });
  await db.insert(schema.scraperRuns).values({
    scraper: SCRAPER,
    target: "test_stale_recent_fail",
    status: "failed",
    itemsSucceeded: 0,
    startedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    finishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000 + 5_000),
  });

  const r1 = await runSourceHealthCheck();
  console.log("Alerts after A:", r1.alertsByCode);
  const haveStale = !!r1.alertsByCode[`SOURCE_HEALTH:STALE:${SCRAPER}`];
  console.log(`✓ STALE alert raised: ${haveStale}`);

  // ── Scenario B: LOW_QUALITY — 5 runs, 1 success ──────────────────
  // Add multiple failed runs in last 24h to trigger LOW_QUALITY
  console.log("\nScenario B: LOW_QUALITY (1/5 success in 24h)");
  // Add fresh successful run so STALE clears, but with lots of failures
  await db.delete(schema.alerts).where(sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`);
  await db.delete(schema.scraperRuns).where(sql`target LIKE 'test_%'`);

  await db.insert(schema.scraperRuns).values({
    scraper: SCRAPER,
    target: "test_lq_success",
    status: "success",
    itemsSucceeded: 10,
    costUsdMicros: 5_000,
    startedAt: new Date(Date.now() - 30 * 60 * 1000),
    finishedAt: new Date(Date.now() - 30 * 60 * 1000 + 30_000),
  });
  for (let i = 0; i < 4; i++) {
    await db.insert(schema.scraperRuns).values({
      scraper: SCRAPER,
      target: `test_lq_fail_${i}`,
      status: "failed",
      itemsSucceeded: 0,
      startedAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000 + 5_000),
    });
  }

  const r2 = await runSourceHealthCheck();
  console.log("Alerts after B:", r2.alertsByCode);
  const haveLQ = !!r2.alertsByCode[`SOURCE_HEALTH:LOW_QUALITY:${SCRAPER}`];
  console.log(`✓ LOW_QUALITY alert raised: ${haveLQ}`);

  // ── Scenario C: COST_SPIKE — recent cost 5× baseline ─────────────
  console.log("\nScenario C: COST_SPIKE (recent 5× baseline cost-per-item)");
  await db.delete(schema.alerts).where(sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`);
  await db.delete(schema.scraperRuns).where(sql`target LIKE 'test_%'`);

  // 7d baseline: 5 successful runs at $0.0005/item
  for (let i = 0; i < 5; i++) {
    await db.insert(schema.scraperRuns).values({
      scraper: SCRAPER,
      target: `test_baseline_${i}`,
      status: "success",
      itemsSucceeded: 100,
      costUsdMicros: 50_000,  // $0.0005/item
      startedAt: new Date(Date.now() - (2 + i) * 24 * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - (2 + i) * 24 * 60 * 60 * 1000 + 30_000),
    });
  }
  // Last 24h: 3 successful runs at $0.005/item — 10× spike
  for (let i = 0; i < 3; i++) {
    await db.insert(schema.scraperRuns).values({
      scraper: SCRAPER,
      target: `test_spike_${i}`,
      status: "success",
      itemsSucceeded: 100,
      costUsdMicros: 500_000,
      startedAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000),
      finishedAt: new Date(Date.now() - (i + 1) * 60 * 60 * 1000 + 30_000),
    });
  }

  const r3 = await runSourceHealthCheck();
  console.log("Alerts after C:", r3.alertsByCode);
  const haveSpike = !!r3.alertsByCode[`SOURCE_HEALTH:COST_SPIKE:${SCRAPER}`];
  console.log(`✓ COST_SPIKE alert raised: ${haveSpike}`);

  // ── Scenario D: auto-clear on success ────────────────────────────
  console.log("\nScenario D: clearSourceHealthAlerts() resolves open alerts");
  const beforeClear = await db.select({ id: schema.alerts.id })
    .from(schema.alerts)
    .where(and(
      sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`,
      isNull(schema.alerts.resolvedAt),
    ));
  console.log(`Open alerts before clear: ${beforeClear.length}`);
  await clearSourceHealthAlerts(SCRAPER);
  const afterClear = await db.select({ id: schema.alerts.id })
    .from(schema.alerts)
    .where(and(
      sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`,
      isNull(schema.alerts.resolvedAt),
    ));
  console.log(`Open alerts after clear:  ${afterClear.length}`);
  const cleared = beforeClear.length > 0 && afterClear.length === 0;
  console.log(`✓ alerts auto-cleared: ${cleared}`);

  // ── Cleanup synthetic rows ───────────────────────────────────────
  await db.delete(schema.alerts).where(sql`code LIKE ${`SOURCE_HEALTH:%:${SCRAPER}`}`);
  await db.delete(schema.scraperRuns).where(sql`target LIKE 'test_%'`);

  if (haveStale && haveLQ && haveSpike && cleared) {
    console.log("\n✅ ALL SCENARIOS PASS");
  } else {
    console.log(`\n❌ FAIL: stale=${haveStale} lq=${haveLQ} spike=${haveSpike} cleared=${cleared}`);
    process.exit(1);
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

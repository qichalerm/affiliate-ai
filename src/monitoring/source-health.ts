/**
 * M0 Source Health Monitor — Sprint 17.
 *
 * Watches scraper_runs to catch silent degradation: a scraper that
 * runs on schedule but produces no items, or one whose cost-per-item
 * has tripled, is broken even though no exception was thrown. We
 * detect three failure modes per scraper:
 *
 *   STALE        — no SUCCESS run in the last STALE_HOURS
 *   LOW_QUALITY  — last 24h success rate < SUCCESS_RATE_THRESHOLD
 *   COST_SPIKE   — recent cost-per-item ≥ baseline × COST_SPIKE_MULTIPLE
 *
 * Each detection writes an `alerts` row with code SOURCE_HEALTH:* and
 * a 6-hour cooldown so we don't spam the same alert. Operator sees
 * unresolved alerts in their dashboard / digest (Sprint 18+).
 *
 * Why fail loudly: the scrape is the apex of the dependency tree. If
 * Shopee blocks our Apify proxy, every downstream module starves. We
 * want an alert within an hour, not "wait until tomorrow's report."
 */

import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";

const log = child("monitoring.source-health");

// ── Thresholds ──────────────────────────────────────────────────────
/** No success in this many hours = STALE. */
const STALE_HOURS = 6;
/** Success-rate floor over last 24h. */
const SUCCESS_RATE_THRESHOLD = 0.5;
/** Cost spike trigger (recent cost ÷ baseline cost). */
const COST_SPIKE_MULTIPLE = 3.0;
/** Don't re-fire same alert code/scraper within this window. */
const ALERT_COOLDOWN_HOURS = 6;
/** Need at least this many runs in 24h before judging success rate. */
const MIN_RUNS_FOR_RATE = 3;

export interface SourceHealthResult {
  scrapersChecked: string[];
  alertsRaised: number;
  alertsByCode: Record<string, number>;
}

interface ScraperRollup {
  scraper: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  totalItems: number;
  totalCostMicros: number;
  lastSuccessAt: Date | null;
  successRate: number;
  costPerItemMicros: number;
  [k: string]: unknown;  // satisfies db.execute<T> Record<string, unknown> constraint
}

export async function runSourceHealthCheck(): Promise<SourceHealthResult> {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const cooldownCutoff = new Date(Date.now() - ALERT_COOLDOWN_HOURS * 60 * 60 * 1000);

  // 24h rollup per scraper
  const recent = await db.execute<ScraperRollup>(sql`
    SELECT
      scraper::text AS scraper,
      COUNT(*)::int AS "totalRuns",
      COUNT(*) FILTER (WHERE status = 'success')::int AS "successfulRuns",
      COUNT(*) FILTER (WHERE status = 'failed')::int AS "failedRuns",
      COALESCE(SUM(items_succeeded), 0)::int AS "totalItems",
      COALESCE(SUM(cost_usd_micros), 0)::bigint AS "totalCostMicros",
      MAX(started_at) FILTER (WHERE status = 'success') AS "lastSuccessAt",
      CASE WHEN COUNT(*) > 0
           THEN COUNT(*) FILTER (WHERE status = 'success')::float / COUNT(*)
           ELSE 0 END AS "successRate",
      CASE WHEN SUM(items_succeeded) > 0
           THEN SUM(cost_usd_micros)::float / SUM(items_succeeded)
           ELSE 0 END AS "costPerItemMicros"
    FROM scraper_runs
    WHERE started_at >= ${since24h.toISOString()}::timestamptz
    GROUP BY scraper
  `);

  // 7d baseline (excluding the last 24h) for cost-spike comparison
  const baseline = await db.execute<{ scraper: string; baselineCostPerItem: number }>(sql`
    SELECT
      scraper::text AS scraper,
      CASE WHEN SUM(items_succeeded) > 0
           THEN SUM(cost_usd_micros)::float / SUM(items_succeeded)
           ELSE 0 END AS "baselineCostPerItem"
    FROM scraper_runs
    WHERE started_at >= ${since7d.toISOString()}::timestamptz
      AND started_at < ${since24h.toISOString()}::timestamptz
      AND status = 'success'
    GROUP BY scraper
  `);
  const baselineMap = new Map(baseline.map((b) => [b.scraper, b.baselineCostPerItem]));

  // All scrapers we've ever seen run (so we catch ones gone fully silent)
  const allScrapers = await db.execute<{ scraper: string }>(sql`
    SELECT DISTINCT scraper::text AS scraper FROM scraper_runs
    WHERE started_at >= ${since7d.toISOString()}::timestamptz
  `);
  const recentMap = new Map(recent.map((r) => [r.scraper, r]));

  const result: SourceHealthResult = {
    scrapersChecked: allScrapers.map((s) => s.scraper),
    alertsRaised: 0,
    alertsByCode: {},
  };

  log.info({ scrapers: result.scrapersChecked }, "source health check start");

  for (const scraper of result.scrapersChecked) {
    const r = recentMap.get(scraper);
    const baselineCpi = baselineMap.get(scraper) ?? 0;

    // ── STALE check ────────────────────────────────────────────────
    // db.execute returns timestamps as strings; coerce to Date for comparison.
    const rawLast = r?.lastSuccessAt ?? null;
    const lastSuccess = rawLast ? new Date(rawLast as unknown as string) : null;
    const staleCutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
    if (!lastSuccess || lastSuccess < staleCutoff) {
      const hoursSince = lastSuccess
        ? Math.round((Date.now() - lastSuccess.getTime()) / 3_600_000)
        : null;
      await raiseAlert({
        code: `SOURCE_HEALTH:STALE:${scraper}`,
        severity: "error",
        title: `Scraper "${scraper}" stale`,
        body: hoursSince === null
          ? `No successful run in the last 24h.`
          : `Last successful run was ${hoursSince}h ago (threshold: ${STALE_HOURS}h).`,
        metadata: { scraper, hoursSinceLastSuccess: hoursSince },
        cooldownCutoff,
        result,
      });
    }

    // ── LOW_QUALITY check ──────────────────────────────────────────
    if (r && r.totalRuns >= MIN_RUNS_FOR_RATE && r.successRate < SUCCESS_RATE_THRESHOLD) {
      await raiseAlert({
        code: `SOURCE_HEALTH:LOW_QUALITY:${scraper}`,
        severity: "warn",
        title: `Scraper "${scraper}" success rate degraded`,
        body: `Only ${(r.successRate * 100).toFixed(0)}% of runs succeeded ` +
              `(${r.successfulRuns}/${r.totalRuns} in 24h, threshold ${SUCCESS_RATE_THRESHOLD * 100}%).`,
        metadata: {
          scraper,
          successRate: r.successRate,
          successfulRuns: r.successfulRuns,
          failedRuns: r.failedRuns,
          totalRuns: r.totalRuns,
        },
        cooldownCutoff,
        result,
      });
    }

    // ── COST_SPIKE check ───────────────────────────────────────────
    if (r && r.costPerItemMicros > 0 && baselineCpi > 0) {
      const multiple = r.costPerItemMicros / baselineCpi;
      if (multiple >= COST_SPIKE_MULTIPLE) {
        await raiseAlert({
          code: `SOURCE_HEALTH:COST_SPIKE:${scraper}`,
          severity: "warn",
          title: `Scraper "${scraper}" cost-per-item spiked`,
          body: `Last 24h cost/item is ${multiple.toFixed(1)}× the 7d baseline ` +
                `($${(r.costPerItemMicros / 1e6).toFixed(4)} vs $${(baselineCpi / 1e6).toFixed(4)}).`,
          metadata: {
            scraper,
            recentCostPerItemUsd: r.costPerItemMicros / 1e6,
            baselineCostPerItemUsd: baselineCpi / 1e6,
            multiple,
          },
          cooldownCutoff,
          result,
        });
      }
    }
  }

  log.info(
    { scrapers: result.scrapersChecked.length, alertsRaised: result.alertsRaised, byCode: result.alertsByCode },
    "source health check done",
  );

  return result;
}

interface RaiseAlertInput {
  code: string;
  severity: "info" | "warn" | "error" | "critical";
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  cooldownCutoff: Date;
  result: SourceHealthResult;
}

async function raiseAlert(a: RaiseAlertInput): Promise<void> {
  // Cooldown: skip if same code is unresolved AND created within cooldown
  const existing = await db
    .select({ id: schema.alerts.id })
    .from(schema.alerts)
    .where(
      and(
        eq(schema.alerts.code, a.code),
        gte(schema.alerts.createdAt, a.cooldownCutoff),
        isNull(schema.alerts.resolvedAt),
      ),
    )
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(schema.alerts).values({
    severity: a.severity,
    code: a.code,
    title: a.title,
    body: a.body,
    metadata: a.metadata,
    requiresUserAction: a.severity === "error" || a.severity === "critical",
  });

  a.result.alertsRaised++;
  a.result.alertsByCode[a.code] = (a.result.alertsByCode[a.code] ?? 0) + 1;
  log.warn({ code: a.code, severity: a.severity, title: a.title }, "alert raised");
}

/**
 * Mark all open SOURCE_HEALTH alerts for a scraper as resolved. Called
 * by the scrape runner on a successful run so alerts auto-clear when
 * the source recovers.
 */
export async function clearSourceHealthAlerts(scraper: string): Promise<void> {
  await db
    .update(schema.alerts)
    .set({ resolvedAt: new Date() })
    .where(
      and(
        sql`code LIKE ${`SOURCE_HEALTH:%:${scraper}`}`,
        isNull(schema.alerts.resolvedAt),
      ),
    );
}

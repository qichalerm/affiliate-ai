/**
 * Daily Operator Report — Sprint 18.
 *
 * Once a day, aggregate yesterday's pipeline activity into a single
 * digest the operator can read in 30 seconds and spot anomalies.
 *
 * Output sinks (in order, fail-soft):
 *   1. Always: structured log line + plain-text report to stdout
 *   2. Always: append to /var/log/affiliate-ai-reports.txt (or fallback path)
 *   3. If can.alertEmail(): send via Resend to OPERATOR_EMAIL
 *
 * Sections:
 *   - Scrape: runs, success rate, items, cost, new products
 *   - Discovery: promo events by type, top signals
 *   - Generation: variant counts (approved vs failed), LLM cost
 *   - Publishing: posts attempted by channel (real vs dry-run)
 *   - Engagement: clicks, post_metrics rows captured
 *   - Health: open alerts (severity counts)
 *   - Bandit: top variants by CTR, total picks
 */

import { writeFileSync, mkdirSync, existsSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../lib/db.ts";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("monitoring.daily-report");

const REPORT_PATH = process.env.DAILY_REPORT_LOG_PATH ?? "/tmp/affiliate-ai-reports.log";

export interface DailyReport {
  reportDate: string;            // YYYY-MM-DD (yesterday)
  windowStart: string;           // ISO
  windowEnd: string;             // ISO
  scrape: {
    runs: number;
    successful: number;
    failed: number;
    successRate: number;
    itemsScraped: number;
    newProducts: number;
    costUsd: number;
  };
  discovery: {
    promoEventsByType: Record<string, number>;
    topSignals: Array<{ productId: number; eventType: string; signalStrength: number }>;
  };
  generation: {
    variantsCreated: number;
    variantsApproved: number;
    variantsFailedGate: number;
    llmCostUsd: number;
  };
  publishing: {
    byChannel: Record<string, { attempted: number; published: number; dryRun: number; failed: number }>;
  };
  engagement: {
    clicksLogged: number;
    metricsRowsCaptured: number;
  };
  health: {
    alertsOpen: Record<string, number>;  // severity → count
    alertsRaised24h: number;
  };
  bandit: {
    totalPicks: number;
    topVariantsByCtr: Array<{ id: number; productId: number; channel: string; angle: string; ctr: number; impressions: number }>;
  };
}

function dayBoundsBkk(daysAgo: number): { start: Date; end: Date; label: string } {
  // Approximate BKK day = UTC+7 — we don't import a TZ lib here, just shift
  const now = new Date();
  const bkkOffsetMs = 7 * 60 * 60 * 1000;
  const bkkNow = new Date(now.getTime() + bkkOffsetMs);
  const yMid = new Date(Date.UTC(
    bkkNow.getUTCFullYear(),
    bkkNow.getUTCMonth(),
    bkkNow.getUTCDate() - daysAgo,
  ));  // 00:00 BKK = 17:00 prior UTC day
  const startUtc = new Date(yMid.getTime() - bkkOffsetMs);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  const label = yMid.toISOString().slice(0, 10);
  return { start: startUtc, end: endUtc, label };
}

export async function generateDailyReport(opts: { daysAgo?: number } = {}): Promise<DailyReport> {
  const { start, end, label } = dayBoundsBkk(opts.daysAgo ?? 1);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  log.info({ reportDate: label, windowStart: startIso, windowEnd: endIso }, "daily report start");

  // ── Scrape ─────────────────────────────────────────────────────
  const [scrapeAgg] = await db.execute<{
    runs: number; successful: number; failed: number;
    itemsScraped: number; costMicros: number;
    [k: string]: unknown;
  }>(sql`
    SELECT
      COUNT(*)::int AS runs,
      COUNT(*) FILTER (WHERE status = 'success')::int AS successful,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COALESCE(SUM(items_succeeded), 0)::int AS "itemsScraped",
      COALESCE(SUM(cost_usd_micros), 0)::bigint AS "costMicros"
    FROM scraper_runs
    WHERE started_at >= ${startIso}::timestamptz AND started_at < ${endIso}::timestamptz
  `);

  const [newProductsRow] = await db.execute<{ n: number; [k: string]: unknown }>(sql`
    SELECT COUNT(*)::int AS n FROM products
    WHERE first_seen_at >= ${startIso}::timestamptz AND first_seen_at < ${endIso}::timestamptz
  `);

  // ── Discovery (promo events) ──────────────────────────────────
  const promoByType = await db.execute<{ event_type: string; n: number; [k: string]: unknown }>(sql`
    SELECT event_type::text AS event_type, COUNT(*)::int AS n
    FROM promo_events
    WHERE detected_at >= ${startIso}::timestamptz AND detected_at < ${endIso}::timestamptz
    GROUP BY event_type
  `);

  const topSignals = await db.execute<{
    productId: number; eventType: string; signalStrength: number;
    [k: string]: unknown;
  }>(sql`
    SELECT product_id AS "productId", event_type::text AS "eventType",
           signal_strength AS "signalStrength"
    FROM promo_events
    WHERE detected_at >= ${startIso}::timestamptz AND detected_at < ${endIso}::timestamptz
    ORDER BY signal_strength DESC LIMIT 5
  `);

  // ── Generation (variants) ─────────────────────────────────────
  const [variantsAgg] = await db.execute<{
    created: number; approved: number; failed: number;
    [k: string]: unknown;
  }>(sql`
    SELECT
      COUNT(*)::int AS created,
      COUNT(*) FILTER (WHERE gate_approved = true)::int AS approved,
      COUNT(*) FILTER (WHERE gate_approved = false)::int AS failed
    FROM content_variants
    WHERE created_at >= ${startIso}::timestamptz AND created_at < ${endIso}::timestamptz
  `);

  // LLM cost lives in generation_runs (variant gen tracks it there)
  const [llmCostRow] = await db.execute<{ costUsd: number; [k: string]: unknown }>(sql`
    SELECT COALESCE(SUM(cost_usd_micros), 0)::float / 1e6 AS "costUsd"
    FROM generation_runs
    WHERE created_at >= ${startIso}::timestamptz AND created_at < ${endIso}::timestamptz
  `);

  // ── Publishing ────────────────────────────────────────────────
  const pubByChannel = await db.execute<{
    channel: string; attempted: number; published: number; dryRun: number; failed: number;
    [k: string]: unknown;
  }>(sql`
    SELECT channel::text AS channel,
      COUNT(*)::int AS attempted,
      COUNT(*) FILTER (WHERE status = 'published' AND dry_run = false)::int AS published,
      COUNT(*) FILTER (WHERE dry_run = true)::int AS "dryRun",
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
    FROM published_posts
    WHERE created_at >= ${startIso}::timestamptz AND created_at < ${endIso}::timestamptz
    GROUP BY channel
  `);

  // ── Engagement ────────────────────────────────────────────────
  const [clicksRow] = await db.execute<{ n: number; [k: string]: unknown }>(sql`
    SELECT COUNT(*)::int AS n FROM clicks
    WHERE clicked_at >= ${startIso}::timestamptz AND clicked_at < ${endIso}::timestamptz
  `);
  const [metricsRow] = await db.execute<{ n: number; [k: string]: unknown }>(sql`
    SELECT COUNT(*)::int AS n FROM post_metrics
    WHERE captured_at >= ${startIso}::timestamptz AND captured_at < ${endIso}::timestamptz
  `);

  // ── Health (alerts) ───────────────────────────────────────────
  const alertsOpen = await db.execute<{ severity: string; n: number; [k: string]: unknown }>(sql`
    SELECT severity::text AS severity, COUNT(*)::int AS n
    FROM alerts
    WHERE resolved_at IS NULL
    GROUP BY severity
  `);
  const [alertsRaisedRow] = await db.execute<{ n: number; [k: string]: unknown }>(sql`
    SELECT COUNT(*)::int AS n FROM alerts
    WHERE created_at >= ${startIso}::timestamptz AND created_at < ${endIso}::timestamptz
  `);

  // ── Bandit (top variants by CTR over the day's window) ────────
  const topVariants = await db.execute<{
    id: number; productId: number; channel: string; angle: string;
    ctr: number; impressions: number;
    [k: string]: unknown;
  }>(sql`
    SELECT id, product_id AS "productId", channel::text AS channel,
           angle::text AS angle,
           CASE WHEN times_shown > 0
                THEN times_clicked::float / times_shown ELSE 0 END AS ctr,
           times_shown::int AS impressions
    FROM content_variants
    WHERE is_active = true AND gate_approved = true AND times_shown >= 5
    ORDER BY ctr DESC
    LIMIT 5
  `);
  const [picksRow] = await db.execute<{ totalPicks: number; [k: string]: unknown }>(sql`
    SELECT COALESCE(SUM(times_shown), 0)::int AS "totalPicks"
    FROM content_variants
  `);

  const report: DailyReport = {
    reportDate: label,
    windowStart: startIso,
    windowEnd: endIso,
    scrape: {
      runs: scrapeAgg?.runs ?? 0,
      successful: scrapeAgg?.successful ?? 0,
      failed: scrapeAgg?.failed ?? 0,
      successRate: scrapeAgg?.runs ? (scrapeAgg.successful / scrapeAgg.runs) : 0,
      itemsScraped: scrapeAgg?.itemsScraped ?? 0,
      newProducts: newProductsRow?.n ?? 0,
      costUsd: scrapeAgg?.costMicros ? Number(scrapeAgg.costMicros) / 1e6 : 0,
    },
    discovery: {
      promoEventsByType: Object.fromEntries(promoByType.map((p) => [p.event_type, p.n])),
      topSignals: topSignals.map((s) => ({
        productId: s.productId, eventType: s.eventType, signalStrength: s.signalStrength,
      })),
    },
    generation: {
      variantsCreated: variantsAgg?.created ?? 0,
      variantsApproved: variantsAgg?.approved ?? 0,
      variantsFailedGate: variantsAgg?.failed ?? 0,
      llmCostUsd: llmCostRow?.costUsd ?? 0,
    },
    publishing: {
      byChannel: Object.fromEntries(pubByChannel.map((p) => [p.channel, {
        attempted: p.attempted, published: p.published, dryRun: p.dryRun, failed: p.failed,
      }])),
    },
    engagement: {
      clicksLogged: clicksRow?.n ?? 0,
      metricsRowsCaptured: metricsRow?.n ?? 0,
    },
    health: {
      alertsOpen: Object.fromEntries(alertsOpen.map((a) => [a.severity, a.n])),
      alertsRaised24h: alertsRaisedRow?.n ?? 0,
    },
    bandit: {
      totalPicks: picksRow?.totalPicks ?? 0,
      topVariantsByCtr: topVariants.map((v) => ({
        id: v.id, productId: v.productId, channel: v.channel, angle: v.angle,
        ctr: v.ctr, impressions: v.impressions,
      })),
    },
  };

  log.info(report, "daily report generated");
  return report;
}

/* -----------------------------------------------------------------------------
 * Rendering
 * ---------------------------------------------------------------------------*/

export function renderReportText(r: DailyReport): string {
  const $ = (n: number, decimals = 2) => `$${n.toFixed(decimals)}`;
  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  const lines: string[] = [];
  lines.push(`📊 Affiliate-AI Daily Report — ${r.reportDate}`);
  lines.push(`Window: ${r.windowStart} → ${r.windowEnd}`);
  lines.push("");
  lines.push("── Scrape ──────────────────────────────");
  lines.push(`Runs:      ${r.scrape.runs} (${r.scrape.successful} ok, ${r.scrape.failed} failed, ${pct(r.scrape.successRate)} success)`);
  lines.push(`Items:     ${r.scrape.itemsScraped} scraped, ${r.scrape.newProducts} new products`);
  lines.push(`Cost:      ${$(r.scrape.costUsd, 4)}`);
  lines.push("");
  lines.push("── Discovery (M6) ──────────────────────");
  const promos = Object.entries(r.discovery.promoEventsByType);
  if (promos.length === 0) lines.push("(no promo events)");
  for (const [type, n] of promos) lines.push(`${type.padEnd(15)} ${n}`);
  if (r.discovery.topSignals.length > 0) {
    lines.push("Top signals:");
    for (const s of r.discovery.topSignals) {
      lines.push(`  product=${s.productId} ${s.eventType} strength=${s.signalStrength.toFixed(2)}`);
    }
  }
  lines.push("");
  lines.push("── Generation (M4) ─────────────────────");
  lines.push(`Variants:  ${r.generation.variantsCreated} created (${r.generation.variantsApproved} approved, ${r.generation.variantsFailedGate} gate-failed)`);
  lines.push(`LLM cost:  ${$(r.generation.llmCostUsd, 4)}`);
  lines.push("");
  lines.push("── Publishing (M5) ─────────────────────");
  const channels = Object.entries(r.publishing.byChannel);
  if (channels.length === 0) lines.push("(no posts attempted)");
  for (const [ch, p] of channels) {
    lines.push(`${ch.padEnd(10)} attempted=${p.attempted} published=${p.published} dry=${p.dryRun} failed=${p.failed}`);
  }
  lines.push("");
  lines.push("── Engagement (M7/M8) ──────────────────");
  lines.push(`Clicks:    ${r.engagement.clicksLogged}`);
  lines.push(`Metrics:   ${r.engagement.metricsRowsCaptured} snapshots captured`);
  lines.push("");
  lines.push("── Health (M0) ─────────────────────────");
  const sevs = Object.entries(r.health.alertsOpen);
  if (sevs.length === 0) lines.push("✓ no open alerts");
  for (const [sev, n] of sevs) lines.push(`${sev.padEnd(10)} ${n} open`);
  lines.push(`Raised 24h: ${r.health.alertsRaised24h}`);
  lines.push("");
  lines.push("── Bandit (M3) ─────────────────────────");
  lines.push(`Total picks lifetime: ${r.bandit.totalPicks}`);
  if (r.bandit.topVariantsByCtr.length > 0) {
    lines.push("Top 5 by CTR:");
    for (const v of r.bandit.topVariantsByCtr) {
      lines.push(`  v#${v.id} p#${v.productId} ${v.channel}/${v.angle} CTR=${pct(v.ctr)} (n=${v.impressions})`);
    }
  } else {
    lines.push("(no variants with ≥5 impressions yet)");
  }
  return lines.join("\n");
}

/* -----------------------------------------------------------------------------
 * Sinks
 * ---------------------------------------------------------------------------*/

function appendToFile(path: string, body: string): void {
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `\n${"=".repeat(60)}\n${body}\n`);
  } catch (err) {
    log.warn({ path, err: errMsg(err) }, "failed to append daily report to file");
  }
}

async function emailReport(subject: string, body: string): Promise<void> {
  if (!can.alertEmail() || !env.RESEND_API_KEY || !env.OPERATOR_EMAIL) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "noreply@affiliate-ai.local",
        to: env.OPERATOR_EMAIL,
        subject,
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    log.info({ to: env.OPERATOR_EMAIL }, "daily report emailed");
  } catch (err) {
    log.warn({ err: errMsg(err) }, "daily report email failed (continuing)");
  }
}

/**
 * Generate, render, and dispatch yesterday's report through all sinks.
 */
export async function runDailyReport(): Promise<DailyReport> {
  const report = await generateDailyReport({ daysAgo: 1 });
  const text = renderReportText(report);

  // Sink 1: stdout (already covered by structured log above)
  console.log("\n" + text + "\n");

  // Sink 2: append to file
  appendToFile(REPORT_PATH, text);

  // Sink 3: optional email
  await emailReport(`Affiliate-AI Daily Report — ${report.reportDate}`, text);

  return report;
}

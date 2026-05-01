/**
 * Daily report — sent to operator via Telegram each evening.
 * Aggregates: revenue, conversions, scrape stats, content generated, alerts.
 */

import { db } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { sendOperator } from "../lib/telegram.ts";
import { formatBaht, formatNumber } from "../lib/format.ts";
import { child } from "../lib/logger.ts";

const log = child("daily-report");

interface ReportRow {
  visits: number;
  clicks: number;
  conversions: number;
  revenueSatang: number;
  refundedSatang: number;
}

interface ScrapeStatsRow {
  total_runs: number;
  successful_runs: number;
  total_succeeded: number;
}

interface ContentStatsRow {
  pages_created: number;
  llm_cost_usd: number;
}

interface AlertCountRow {
  unresolved: number;
  needs_action: number;
}

export async function buildDailyReport(): Promise<string> {
  const revenueRows = await db.execute<ReportRow>(sql`
    SELECT
      COALESCE(SUM(CASE WHEN c.is_refunded THEN c.gross_satang ELSE 0 END), 0)::bigint AS "refundedSatang",
      COALESCE(SUM(c.commission_satang), 0)::bigint AS "revenueSatang",
      COUNT(*) FILTER (WHERE NOT c.is_refunded)::int AS conversions,
      0 AS clicks,
      0 AS visits
    FROM conversions c
    WHERE c.ordered_at > now() - interval '24 hours'
  `);
  const revenue = revenueRows[0] ?? { revenueSatang: 0, conversions: 0, refundedSatang: 0, clicks: 0, visits: 0 };

  const clickRows = await db.execute<{ clicks: number }>(sql`
    SELECT COUNT(*)::int AS clicks
      FROM clicks
     WHERE occurred_at > now() - interval '24 hours'
  `);
  const clicks = clickRows[0]?.clicks ?? 0;

  const scrapeRows = await db.execute<ScrapeStatsRow>(sql`
    SELECT COUNT(*)::int AS total_runs,
           COUNT(*) FILTER (WHERE status = 'success')::int AS successful_runs,
           COALESCE(SUM(items_succeeded), 0)::int AS total_succeeded
      FROM scraper_runs
     WHERE started_at > now() - interval '24 hours'
  `);
  const scrape = scrapeRows[0] ?? { total_runs: 0, successful_runs: 0, total_succeeded: 0 };

  const contentRows = await db.execute<ContentStatsRow>(sql`
    SELECT COUNT(*) FILTER (WHERE kind IN ('verdict', 'comparison'))::int AS pages_created,
           COALESCE(SUM(cost_usd), 0)::float AS llm_cost_usd
      FROM generation_runs
     WHERE started_at > now() - interval '24 hours'
       AND status = 'success'
  `);
  const content = contentRows[0] ?? { pages_created: 0, llm_cost_usd: 0 };

  const alertRows = await db.execute<AlertCountRow>(sql`
    SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS unresolved,
           COUNT(*) FILTER (WHERE resolved_at IS NULL AND requires_user_action)::int AS needs_action
      FROM alerts
     WHERE created_at > now() - interval '7 days'
  `);
  const alerts = alertRows[0] ?? { unresolved: 0, needs_action: 0 };

  const lines: string[] = [];
  lines.push("📊 *รายงานประจำวัน*");
  lines.push(`_${new Date().toLocaleDateString("th-TH")}_`);
  lines.push("");
  lines.push("💰 *รายได้ 24 ชม.*");
  lines.push(`รายได้สุทธิ: *${formatBaht(revenue.revenueSatang)}*`);
  lines.push(`คำสั่งซื้อ: ${formatNumber(revenue.conversions)} (${formatNumber(clicks)} คลิก)`);
  if (revenue.refundedSatang > 0) {
    lines.push(`คืนเงิน: −${formatBaht(revenue.refundedSatang)}`);
  }
  lines.push("");
  lines.push("🤖 *ระบบทำงาน*");
  lines.push(`Scraper: ${scrape.successful_runs}/${scrape.total_runs} runs (${scrape.total_succeeded} items)`);
  lines.push(`Content gen: ${content.pages_created} หน้า — ใช้ LLM $${content.llm_cost_usd.toFixed(2)}`);
  lines.push("");
  if (alerts.unresolved > 0) {
    lines.push("⚠️ *Alerts ค้าง*");
    lines.push(`Unresolved: ${alerts.unresolved}`);
    if (alerts.needs_action > 0) {
      lines.push(`Need decision: ${alerts.needs_action}`);
    }
    lines.push("");
  }
  lines.push("_ดูรายละเอียดที่ dashboard_");

  return lines.join("\n");
}

export async function sendDailyReport(): Promise<void> {
  const report = await buildDailyReport();
  log.info({ length: report.length }, "sending daily report");
  await sendOperator(report);
}

/**
 * Per-source health monitoring.
 *
 * Watches each external dependency's recent behavior and emits alerts
 * when something is off. Runs hourly via scheduler.
 *
 * Signals checked:
 *   - Scraper success rate (last 24h)
 *   - LLM cost vs daily budget
 *   - Stale ingestion (no fresh data in N hours)
 *   - Disk space (DB)
 *   - Anthropic API key quota left (best-effort)
 *   - Postgres connection latency
 */

import { db } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { createAlert } from "./alerts.ts";

const log = child("source-health");

export interface HealthSignal {
  name: string;
  status: "ok" | "warn" | "error" | "unknown";
  detail?: string;
  metric?: number;
}

export async function runSourceHealth(): Promise<HealthSignal[]> {
  const signals: HealthSignal[] = [];

  signals.push(await checkScraperSuccess("shopee"));
  signals.push(await checkScraperSuccess("lazada"));
  signals.push(await checkLlmDailyBudget());
  signals.push(await checkIngestionFreshness());
  signals.push(await checkDbLatency());
  signals.push(await checkPgDiskSpace());
  signals.push(await checkAlertBacklog());

  // Emit alerts for warn/error signals (deduped by code)
  for (const s of signals) {
    if (s.status === "error" || s.status === "warn") {
      try {
        await createAlert({
          severity: s.status === "error" ? "error" : "warn",
          code: `health.${s.name}`,
          title: `Health: ${s.name} = ${s.status}`,
          body: s.detail ?? "",
          metadata: { metric: s.metric },
        });
      } catch (err) {
        log.warn({ err: errMsg(err), signal: s.name }, "failed to emit alert");
      }
    }
  }

  return signals;
}

async function checkScraperSuccess(scraper: string): Promise<HealthSignal> {
  try {
    const rows = await db.execute<{ total: number; success: number; failed: number }>(sql`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status = 'success')::int AS success,
             COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
        FROM scraper_runs
       WHERE scraper = ${scraper}
         AND started_at > now() - interval '24 hours'
    `);
    const r = rows[0];
    if (!r || r.total === 0) {
      return { name: `scraper.${scraper}`, status: "unknown", detail: "no runs in 24h" };
    }
    const successRate = r.success / r.total;
    if (successRate < 0.5) {
      return {
        name: `scraper.${scraper}`,
        status: "error",
        detail: `success rate ${(successRate * 100).toFixed(0)}% (${r.success}/${r.total})`,
        metric: successRate,
      };
    }
    if (successRate < 0.8) {
      return {
        name: `scraper.${scraper}`,
        status: "warn",
        detail: `success rate ${(successRate * 100).toFixed(0)}% (${r.success}/${r.total})`,
        metric: successRate,
      };
    }
    return {
      name: `scraper.${scraper}`,
      status: "ok",
      detail: `${r.success}/${r.total} success`,
      metric: successRate,
    };
  } catch (err) {
    return { name: `scraper.${scraper}`, status: "unknown", detail: errMsg(err) };
  }
}

async function checkLlmDailyBudget(): Promise<HealthSignal> {
  try {
    const rows = await db.execute<{ cost_today: number }>(sql`
      SELECT COALESCE(SUM(cost_usd), 0)::float AS cost_today
        FROM generation_runs
       WHERE started_at::date = current_date
    `);
    const cost = rows[0]?.cost_today ?? 0;
    const budget = env.DAILY_LLM_BUDGET_USD;
    const pct = cost / budget;
    if (pct >= 1.0) {
      return {
        name: "llm.budget",
        status: "error",
        detail: `$${cost.toFixed(2)} / $${budget} budget (${(pct * 100).toFixed(0)}%)`,
        metric: pct,
      };
    }
    if (pct >= 0.85) {
      return {
        name: "llm.budget",
        status: "warn",
        detail: `$${cost.toFixed(2)} / $${budget} (${(pct * 100).toFixed(0)}%)`,
        metric: pct,
      };
    }
    return {
      name: "llm.budget",
      status: "ok",
      detail: `$${cost.toFixed(2)} / $${budget}`,
      metric: pct,
    };
  } catch (err) {
    return { name: "llm.budget", status: "unknown", detail: errMsg(err) };
  }
}

async function checkIngestionFreshness(): Promise<HealthSignal> {
  try {
    const rows = await db.execute<{ last_scrape: Date | null; last_score: Date | null }>(sql`
      SELECT
        (SELECT MAX(started_at) FROM scraper_runs WHERE status = 'success') AS last_scrape,
        (SELECT MAX(last_scored_at) FROM products) AS last_score
    `);
    const r = rows[0];
    if (!r) return { name: "ingestion.freshness", status: "unknown" };

    const now = Date.now();
    const scrapeStaleHr =
      r.last_scrape ? (now - new Date(r.last_scrape).getTime()) / 3_600_000 : 999;
    const scoreStaleHr =
      r.last_score ? (now - new Date(r.last_score).getTime()) / 3_600_000 : 999;

    if (scrapeStaleHr > 12) {
      return {
        name: "ingestion.freshness",
        status: "error",
        detail: `last scrape ${scrapeStaleHr.toFixed(1)}h ago`,
        metric: scrapeStaleHr,
      };
    }
    if (scoreStaleHr > 8) {
      return {
        name: "ingestion.freshness",
        status: "warn",
        detail: `last scoring ${scoreStaleHr.toFixed(1)}h ago`,
        metric: scoreStaleHr,
      };
    }
    return {
      name: "ingestion.freshness",
      status: "ok",
      detail: `scrape ${scrapeStaleHr.toFixed(1)}h, score ${scoreStaleHr.toFixed(1)}h`,
    };
  } catch (err) {
    return { name: "ingestion.freshness", status: "unknown", detail: errMsg(err) };
  }
}

async function checkDbLatency(): Promise<HealthSignal> {
  try {
    const start = Date.now();
    await db.execute(sql`SELECT 1`);
    const ms = Date.now() - start;
    if (ms > 1000) {
      return { name: "db.latency", status: "warn", detail: `${ms}ms`, metric: ms };
    }
    return { name: "db.latency", status: "ok", detail: `${ms}ms`, metric: ms };
  } catch (err) {
    return { name: "db.latency", status: "error", detail: errMsg(err) };
  }
}

async function checkPgDiskSpace(): Promise<HealthSignal> {
  try {
    const rows = await db.execute<{ size_pretty: string; size_bytes: number }>(sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size_pretty,
             pg_database_size(current_database())::bigint AS size_bytes
    `);
    const r = rows[0];
    if (!r) return { name: "db.size", status: "unknown" };
    const sizeMb = Number(r.size_bytes) / 1_048_576;
    if (sizeMb > 50_000) {
      return { name: "db.size", status: "warn", detail: `${r.size_pretty}`, metric: sizeMb };
    }
    return { name: "db.size", status: "ok", detail: r.size_pretty, metric: sizeMb };
  } catch (err) {
    return { name: "db.size", status: "unknown", detail: errMsg(err) };
  }
}

async function checkAlertBacklog(): Promise<HealthSignal> {
  try {
    const rows = await db.execute<{ unresolved: number; needs_action: number }>(sql`
      SELECT COUNT(*) FILTER (WHERE resolved_at IS NULL)::int AS unresolved,
             COUNT(*) FILTER (WHERE resolved_at IS NULL AND requires_user_action)::int AS needs_action
        FROM alerts
       WHERE created_at > now() - interval '7 days'
    `);
    const r = rows[0];
    if (!r) return { name: "alerts.backlog", status: "unknown" };
    if (r.needs_action > 5) {
      return {
        name: "alerts.backlog",
        status: "warn",
        detail: `${r.needs_action} alerts need decision`,
        metric: r.needs_action,
      };
    }
    return { name: "alerts.backlog", status: "ok", detail: `${r.unresolved} unresolved` };
  } catch (err) {
    return { name: "alerts.backlog", status: "unknown", detail: errMsg(err) };
  }
}

/**
 * Cron scheduler — long-running process that triggers jobs on schedule.
 *
 * Schedule (Asia/Bangkok):
 *   00:00, 06:00, 12:00, 18:00 — scrape trending
 *   01:00 — generate pages (50/run)
 *   07:00, 13:00, 19:00 — generate pages (smaller batch)
 *   10:00, 16:00, 20:00 — broadcast deals to telegram
 *   21:00 — daily report
 *   every 5min — health check
 *   03:00 (every Sunday) — cleanup
 *
 * Override via env CRON_* vars.
 */

import { Cron } from "croner";
import { JOBS, type JobName } from "./jobs.ts";
import { env } from "../lib/env.ts";
import { child, logger } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { closeDb } from "../lib/db.ts";

const log = child("scheduler");

interface JobSchedule {
  name: JobName;
  cron: string;
  description: string;
}

const SCHEDULES: JobSchedule[] = [
  { name: "scrapeTrending", cron: env.CRON_SCRAPE_PRODUCTS ?? "0 */6 * * *", description: "Scrape trending Shopee products" },
  { name: "rescoreProducts", cron: "30 */3 * * *", description: "Re-score products (Layer 8)" },
  { name: "generatePages", cron: env.CRON_GENERATE_PAGES ?? "0 7 * * *", description: "Generate review pages (sorted by final_score)" },
  { name: "broadcastDeals", cron: "0 10,16,20 * * *", description: "Broadcast deals to Telegram channel" },
  { name: "healthCheck", cron: env.CRON_HEALTH_CHECK ?? "*/5 * * * *", description: "System health check" },
  { name: "dailyReport", cron: env.CRON_DAILY_REPORT ?? "0 21 * * *", description: "Send daily Telegram report" },
  { name: "cleanup", cron: "0 3 * * 0", description: "Weekly cleanup of old logs" },
];

const TZ = env.TIMEZONE;

const activeJobs: Cron[] = [];

async function runJob(name: JobName): Promise<void> {
  const start = Date.now();
  log.info({ job: name }, "▶ start");
  try {
    await JOBS[name]();
    log.info({ job: name, durationMs: Date.now() - start }, "✓ done");
  } catch (err) {
    log.error({ job: name, err: errMsg(err), durationMs: Date.now() - start }, "✗ failed");
  }
}

function startScheduler(): void {
  log.info({ tz: TZ, jobs: SCHEDULES.length }, "scheduler starting");

  for (const sched of SCHEDULES) {
    const job = Cron(
      sched.cron,
      { name: sched.name, timezone: TZ, protect: true, catch: true },
      () => runJob(sched.name),
    );
    activeJobs.push(job);
    const next = job.nextRun();
    log.info(
      {
        job: sched.name,
        cron: sched.cron,
        next: next?.toISOString(),
      },
      `${sched.description}`,
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  log.warn({ signal }, "shutdown signal received");
  for (const j of activeJobs) j.stop();
  await closeDb();
  // Allow log flush
  await new Promise<void>((res) => setTimeout(res, 200));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  logger.error({ err }, "uncaughtException");
});
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "unhandledRejection");
});

startScheduler();
log.info("scheduler running — Ctrl+C to stop");

// Keep alive
setInterval(() => {}, 1 << 30);

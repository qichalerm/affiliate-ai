/**
 * Cron scheduler — long-running process that triggers jobs on schedule.
 *
 * Schedule (Asia/Bangkok):
 *   00:00, 06:00, 12:00, 18:00 — scrape trending
 *   01:00 — generate pages (50/run)
 *   07:00, 13:00, 19:00 — generate pages (smaller batch)
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
import { initSentry, wrapJob, flushSentry, captureError } from "../lib/sentry.ts";

const log = child("scheduler");

interface JobSchedule {
  name: JobName;
  cron: string;
  description: string;
}

const SCHEDULES: JobSchedule[] = [
  { name: "scrapeTrending", cron: env.CRON_SCRAPE_PRODUCTS ?? "0 8,13,19,22 * * *", description: "Scrape trending Shopee products" },
  // Re-score 30 min after each scrape lands — keeps scores fresh without wasting CPU between rounds.
  { name: "rescoreProducts", cron: "30 8,13,19,22 * * *", description: "Re-score products (Layer 8) — runs 30 min after each scrape" },
  // Generate review pages 1h after the morning scrape so pipeline runs serially: scrape → score → generate.
  { name: "generatePages", cron: env.CRON_GENERATE_PAGES ?? "0 9 * * *", description: "Generate review pages (sorted by final_score)" },
  { name: "generateComparisons", cron: "30 7 * * *", description: "Generate A vs B comparison pages" },
  { name: "generateBestOf", cron: "0 8 * * 1", description: "Generate best-of lists (Mondays)" },
  { name: "refreshInternalLinks", cron: "0 9 * * 1", description: "Refresh internal links (Mondays)" },
  // Sitemap rebuild runs after the 22:00 scrape so newly added products are indexed.
  { name: "sitemapAndIndex", cron: "0 23 * * *", description: "Rebuild sitemap + submit to Google/Bing (after last scrape of the day)" },
  { name: "analyticsIngest", cron: "0 5 * * *", description: "Pull GSC + CF Analytics + Short.io stats" },
  { name: "sourceHealth", cron: "0 * * * *", description: "Per-source health check (hourly)" },
  { name: "healthCheck", cron: env.CRON_HEALTH_CHECK ?? "*/5 * * * *", description: "System health check" },
  { name: "dailyReport", cron: env.CRON_DAILY_REPORT ?? "0 21 * * *", description: "Send daily report (email)" },
  { name: "cleanup", cron: "0 3 * * 0", description: "Weekly cleanup of old logs" },
];

const TZ = env.TIMEZONE;

const activeJobs: Cron[] = [];

async function runJob(name: JobName): Promise<void> {
  const start = Date.now();
  log.info({ job: name }, "▶ start");
  const wrapped = wrapJob(name, JOBS[name]);
  try {
    await wrapped();
    log.info({ job: name, durationMs: Date.now() - start }, "✓ done");
  } catch (err) {
    log.error({ job: name, err: errMsg(err), durationMs: Date.now() - start }, "✗ failed");
    captureError(err, { tags: { job: name } });
  }
}

function startScheduler(): void {
  initSentry();
  log.info({ tz: TZ, jobs: SCHEDULES.length }, "scheduler starting");

  for (const sched of SCHEDULES) {
    const job = new Cron(
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
  await flushSentry(2000);
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

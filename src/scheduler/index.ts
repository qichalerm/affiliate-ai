/**
 * Cron scheduler — long-running process that triggers jobs on schedule.
 *
 * Sprint 0: skeleton only — health check every 5 min.
 * Sprint 1: + click tracking ingest
 * Sprint 2: + Apify scrape
 * Sprint 4-12: + content gen, publishers, brain, learning, etc.
 *
 * Override cron via env CRON_* vars.
 */

import { Cron } from "croner";
import { env, summarizeCapabilities } from "../lib/env.ts";
import { logger, child } from "../lib/logger.ts";
import { closeDb, pingDb } from "../lib/db.ts";
import { errMsg } from "../lib/retry.ts";
import {
  jobScrapeTrending,
  jobLearningOptimizer,
  jobPromoHunter,
  jobEngagementTracker,
  jobSourceHealth,
  jobDailyReport,
  jobBackfillTranslations,
  jobScrapeTikTokShop,
  jobShopeeVideoDigest,
  jobAutoPublish,
} from "./jobs.ts";

const log = child("scheduler");

interface JobSchedule {
  name: string;
  cron: string;
  description: string;
  handler: () => Promise<void>;
}

/* -----------------------------------------------------------------------------
 * Active jobs:
 *   Sprint 0: healthCheck
 *   Sprint 2: scrapeTrending (Apify Shopee, multi-niche, 4×/day)
 * ---------------------------------------------------------------------------*/

async function jobHealthCheck(): Promise<void> {
  const dbOk = await pingDb();
  log.info({ dbOk }, "health check");
  if (!dbOk) log.error("DB unreachable");
}

const SCHEDULES: JobSchedule[] = [
  {
    name: "healthCheck",
    cron: "*/5 * * * *",
    description: "DB ping (every 5 min)",
    handler: jobHealthCheck,
  },
  {
    name: "scrapeTrending",
    cron: env.CRON_SCRAPE_PRODUCTS,
    description: "Apify Shopee scrape — multi-niche, 4×/day BKK flash sale times",
    handler: jobScrapeTrending,
  },
  {
    name: "learningOptimizer",
    cron: "0 3 * * *",
    description: "M9 Learning — aggregate perf, deactivate losers, write insights (03:00 BKK)",
    handler: jobLearningOptimizer,
  },
  {
    name: "promoHunter",
    cron: "*/30 * * * *",
    description: "M6 Promo Hunter — detect price drops / discount jumps every 30 min",
    handler: jobPromoHunter,
  },
  {
    name: "engagementTracker",
    cron: "0 */2 * * *",
    description: "M7 Engagement Tracker — poll FB/IG/TikTok analytics every 2 hours",
    handler: jobEngagementTracker,
  },
  {
    name: "sourceHealth",
    cron: "15 * * * *",
    description: "M0 Source Health — detect stale/degraded scrapers (every hour, :15 offset)",
    handler: jobSourceHealth,
  },
  {
    name: "dailyReport",
    cron: "0 8 * * *",
    description: "Daily operator report — yesterday's pipeline digest (08:00 BKK)",
    handler: jobDailyReport,
  },
  {
    name: "backfillTranslations",
    cron: "*/45 * * * *",
    description: "Translate products missing EN/ZH/JA (limit 20/run, idempotent)",
    handler: jobBackfillTranslations,
  },
  {
    name: "scrapeTikTokShop",
    cron: "30 9,15,21 * * *",
    description: "Scrape TikTok Shop 3x/day (no-op until TIKTOK_SHOP_ACTOR_ID set)",
    handler: jobScrapeTikTokShop,
  },
  {
    name: "shopeeVideoDigest",
    cron: "0 10 * * *",
    description: "Email operator the day's Shopee Video upload backlog (10:00 BKK)",
    handler: jobShopeeVideoDigest,
  },
  {
    name: "autoPublish",
    cron: "10,40 8-22 * * *",
    description: "M5 Auto-publish — pick best variant per channel, post (every 30 min, 8AM-10PM BKK)",
    handler: jobAutoPublish,
  },
];

/* -----------------------------------------------------------------------------
 * Boot + lifecycle
 * ---------------------------------------------------------------------------*/

const TZ = env.TIMEZONE;
const activeJobs: Cron[] = [];

async function runJob(name: string, handler: () => Promise<void>): Promise<void> {
  const start = Date.now();
  log.info({ job: name }, "▶ start");
  try {
    await handler();
    log.info({ job: name, durationMs: Date.now() - start }, "✓ done");
  } catch (err) {
    log.error({ job: name, err: errMsg(err), durationMs: Date.now() - start }, "✗ failed");
  }
}

function startScheduler(): void {
  log.info({ tz: TZ, jobs: SCHEDULES.length }, "scheduler starting");
  log.info({ caps: summarizeCapabilities() }, "capabilities");

  for (const sched of SCHEDULES) {
    const job = new Cron(
      sched.cron,
      { name: sched.name, timezone: TZ, protect: true, catch: true },
      () => runJob(sched.name, sched.handler),
    );
    activeJobs.push(job);
    const next = job.nextRun();
    log.info(
      { job: sched.name, cron: sched.cron, next: next?.toISOString() },
      sched.description,
    );
  }
}

async function shutdown(signal: string): Promise<void> {
  log.warn({ signal }, "shutdown signal received");
  for (const job of activeJobs) job.stop();
  await closeDb();
  await new Promise((res) => setTimeout(res, 200));
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

/* -----------------------------------------------------------------------------
 * Mode: long-running scheduler OR one-shot run
 * ---------------------------------------------------------------------------*/

const runOnce = process.env.RUN_ONCE === "true";

if (runOnce) {
  // CI / smoke test — run each job once then exit
  log.info("RUN_ONCE=true → executing all jobs once then exiting");
  for (const sched of SCHEDULES) {
    await runJob(sched.name, sched.handler);
  }
  await closeDb();
  process.exit(0);
} else {
  startScheduler();
  log.info("scheduler running — Ctrl+C to stop");
  // Keep process alive
  setInterval(() => {}, 1 << 30);
}

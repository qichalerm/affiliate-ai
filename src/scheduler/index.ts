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

const log = child("scheduler");

interface JobSchedule {
  name: string;
  cron: string;
  description: string;
  handler: () => Promise<void>;
}

/* -----------------------------------------------------------------------------
 * Sprint 0 jobs — only health check for now.
 * Sprints 1+ append jobs here as modules come online.
 * ---------------------------------------------------------------------------*/

async function jobHealthCheck(): Promise<void> {
  const dbOk = await pingDb();
  log.info({ dbOk }, "health check");
  if (!dbOk) {
    log.error("DB unreachable — alert would fire here in Sprint 1+");
  }
}

const SCHEDULES: JobSchedule[] = [
  {
    name: "healthCheck",
    cron: "*/5 * * * *",
    description: "DB ping + capability check (every 5 min)",
    handler: jobHealthCheck,
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

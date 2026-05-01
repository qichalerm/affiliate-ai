/**
 * Analytics ingestion orchestrator — calls all sources in sequence, then scores.
 */

import { ingestSearchConsole } from "./sources/google-search-console.ts";
import { ingestCloudflareAnalytics } from "./sources/cloudflare-analytics.ts";
import { ingestShortIoStats } from "./sources/shortio.ts";
import { rollupAndScore } from "./content-score.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("analytics.runner");

export async function runAnalyticsIngest(): Promise<{
  gsc: Awaited<ReturnType<typeof ingestSearchConsole>>;
  cf: Awaited<ReturnType<typeof ingestCloudflareAnalytics>>;
  shortio: Awaited<ReturnType<typeof ingestShortIoStats>>;
  scored: Awaited<ReturnType<typeof rollupAndScore>>;
}> {
  log.info("analytics ingestion start");

  const gsc = await safe("gsc", () => ingestSearchConsole({ days: 3 }));
  const cf = await safe("cf", () => ingestCloudflareAnalytics({ days: 3 }));
  const shortio = await safe("shortio", () => ingestShortIoStats({ sinceHours: 48 }));
  const scored = await safe("score", () => rollupAndScore());

  log.info({ gsc, cf, shortio, scored }, "analytics ingestion done");
  return { gsc, cf, shortio, scored };
}

async function safe<T>(name: string, fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return (await fn()) as T;
  } catch (err) {
    log.error({ source: name, err: errMsg(err) }, "ingest source failed");
    return { error: errMsg(err) } as T;
  }
}

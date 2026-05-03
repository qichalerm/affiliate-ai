/**
 * Apify Shopee scraper client (V2 Sprint 2).
 *
 * Wraps Apify's REST API: start actor → poll → fetch dataset → parse.
 * Tracks daily spend in scraper_runs (cost_usd_micros) and enforces
 * APIFY_DAILY_BUDGET_USD before starting a run.
 *
 * Why Apify and not direct Shopee scrape?
 *   See project memory project_phase1_live.md — every other approach
 *   (SOAX, IPRoyal, Scrapfly, Playwright) was blocked at Shopee's
 *   app-layer bot detection. Apify's hosted residential infrastructure
 *   is the only thing that gets through.
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, retry, sleep } from "../../lib/retry.ts";
import { parseApifyShopeeItem, sanitizeForPostgres } from "./parser.ts";
import type { ApifySearchResult, ApifyShopeeRunStats } from "./types.ts";

const log = child("shopee.apify");

const APIFY_BASE = "https://api.apify.com/v2";

interface ApifyRun {
  id: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "ABORTING" | "ABORTED";
  startedAt: string;
  finishedAt?: string;
  defaultDatasetId: string;
  usage?: { totalUsd?: number };
  usageTotalUsd?: number;
  stats?: { runTimeSecs?: number };
  exitCode?: number;
}

class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly cap: number) {
    super(`Apify daily budget exceeded: spent $${spentUsd.toFixed(4)} of $${cap.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Sum of cost_usd_micros for shopee scraper runs today (UTC date).
 */
async function todaySpendUsd(): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const result = await db
    .select({ total: sql<string>`COALESCE(SUM(cost_usd_micros), 0)::text` })
    .from(schema.scraperRuns)
    .where(
      sql`${schema.scraperRuns.startedAt} >= ${todayStart.toISOString()}::timestamptz
        AND ${schema.scraperRuns.scraper} LIKE 'shopee%'`,
    );
  return Number(result[0]?.total ?? 0) / 1_000_000;
}

async function startActorRun(input: unknown): Promise<ApifyRun> {
  const actor = env.APIFY_ACTOR_SHOPEE.replace("/", "~");
  const url = `${APIFY_BASE}/acts/${actor}/runs?token=${env.APIFY_TOKEN}&memory=${env.APIFY_MEMORY_MB}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Apify startRun ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as { data: ApifyRun };
  return json.data;
}

async function getRun(runId: string): Promise<ApifyRun> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}?token=${env.APIFY_TOKEN}`);
  if (!res.ok) throw new Error(`Apify getRun ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { data: ApifyRun };
  return json.data;
}

async function getDataset<T = unknown>(datasetId: string): Promise<T[]> {
  const res = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&token=${env.APIFY_TOKEN}`,
  );
  if (!res.ok) throw new Error(`Apify getDataset ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T[];
}

async function pollUntilDone(
  runId: string,
  opts: { maxWaitSec?: number; pollIntervalSec?: number } = {},
): Promise<ApifyRun> {
  const maxWait = (opts.maxWaitSec ?? 300) * 1000;
  const interval = (opts.pollIntervalSec ?? 3) * 1000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const run = await getRun(runId);
    if (run.status === "SUCCEEDED") return run;
    if (
      run.status === "FAILED" ||
      run.status === "TIMING-OUT" ||
      run.status === "ABORTING" ||
      run.status === "ABORTED"
    ) {
      throw new Error(`Apify run ${runId} ended with status ${run.status} (exit ${run.exitCode ?? "?"})`);
    }
    await sleep(interval);
  }
  throw new Error(`Apify run ${runId} did not complete within ${maxWait}ms`);
}

export interface SearchByKeywordOpts {
  keyword: string;
  maxProducts?: number;
}

/**
 * Run the Apify Shopee actor for a single keyword search.
 * Throws BudgetExceededError before starting if today's spend exceeds cap.
 */
export async function searchByKeyword(opts: SearchByKeywordOpts): Promise<ApifySearchResult> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not configured");

  // Budget gate
  const spent = await todaySpendUsd();
  if (spent >= env.APIFY_DAILY_BUDGET_USD) {
    throw new BudgetExceededError(spent, env.APIFY_DAILY_BUDGET_USD);
  }

  const maxProducts = opts.maxProducts ?? env.SCRAPE_PRODUCTS_PER_KEYWORD;
  log.info(
    { keyword: opts.keyword, maxProducts, spentToday: spent.toFixed(4) },
    "apify shopee scrape start",
  );

  // Actor input — see actor docs: requires { mode, keyword, country, max_items }
  const input = {
    mode: "keyword",
    keyword: opts.keyword,
    country: "th",
    max_items: maxProducts,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "TH" },
  };

  const startedRun = await retry(() => startActorRun(input), { attempts: 3, baseDelayMs: 1000 });
  const finishedRun = await pollUntilDone(startedRun.id);
  const items = await getDataset<Record<string, unknown>>(finishedRun.defaultDatasetId);

  // Parse
  const shopsByExternalId = new Map();
  const products = [];
  for (const raw of items) {
    try {
      const parsed = parseApifyShopeeItem(sanitizeForPostgres(raw));
      if (!parsed) continue;
      products.push(parsed.product);
      if (parsed.shop && !shopsByExternalId.has(parsed.shop.externalId)) {
        shopsByExternalId.set(parsed.shop.externalId, parsed.shop);
      }
    } catch (err) {
      log.warn({ err: errMsg(err) }, "skipped malformed apify item");
    }
  }

  const stats: ApifyShopeeRunStats = {
    costUsd: finishedRun.usage?.totalUsd ?? finishedRun.usageTotalUsd ?? 0,
    durationMs: (finishedRun.stats?.runTimeSecs ?? 0) * 1000,
    itemCount: items.length,
    apifyRunId: finishedRun.id,
  };

  log.info(
    {
      keyword: opts.keyword,
      itemCount: stats.itemCount,
      productCount: products.length,
      costUsd: stats.costUsd.toFixed(4),
      apifyRunId: stats.apifyRunId,
    },
    "apify shopee scrape done",
  );

  return { products, shopsByExternalId, stats };
}

export { BudgetExceededError };

/**
 * TikTok Shop scraper runner — Sprint 26.
 *
 * Mirrors src/scraper/shopee/runner.ts. Uses Apify (the same provider
 * we use for Shopee since direct TikTok scraping triggers their bot
 * defenses). Gated on TIKTOK_SHOP_ACTOR_ID env — when missing, this
 * is a no-op and the scheduler logs that TikTok Shop scrape was skipped.
 *
 * To activate:
 *   1. Pick a working Apify actor at https://apify.com/store?search=tiktok+shop
 *      (community options change frequently — current candidates:
 *       `clockworks/tiktok-shop-scraper`, `apidojo/tiktok-shop-scraper`)
 *   2. Set TIKTOK_SHOP_ACTOR_ID=<actor-id> in .env
 *   3. Map the actor's input schema in apify-client.ts (currently a
 *      pass-through — keyword + country)
 *   4. Confirm the parser handles the actor's output shape (parser.ts
 *      currently expects a generic Shopee-like schema; refine as needed)
 *
 * Why scaffold-now / activate-later: keeps the pipeline ready so the
 * moment we pick an actor, scrape + persist + auto-deploy chain works
 * end-to-end without further code changes.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";
import { searchTikTokShopByKeyword } from "./apify-client.ts";
import { upsertTikTokShopProduct } from "./persist.ts";
import type { Niche } from "./types.ts";

const log = child("tiktok-shop.runner");

export interface TikTokShopScrapeOptions {
  keyword: string;
  niche?: Niche;
  maxProducts?: number;
}

export interface TikTokShopScrapeResult {
  runId: number;
  attempted: number;
  succeeded: number;
  failed: number;
  newProducts: number;
  costUsd: number;
  skippedReason?: string;
}

export async function runTikTokShopScrape(opts: TikTokShopScrapeOptions): Promise<TikTokShopScrapeResult> {
  if (!env.TIKTOK_SHOP_ACTOR_ID) {
    log.info(
      { keyword: opts.keyword },
      "TIKTOK_SHOP_ACTOR_ID not set — skipping (set in .env to enable)",
    );
    return {
      runId: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      newProducts: 0,
      costUsd: 0,
      skippedReason: "TIKTOK_SHOP_ACTOR_ID not configured",
    };
  }

  const [runRow] = await db
    .insert(schema.scraperRuns)
    .values({
      scraper: "tiktok_shop_apify",
      target: opts.keyword,
      status: "running",
    })
    .returning({ id: schema.scraperRuns.id });
  const runId = runRow!.id;

  const startTime = Date.now();
  let succeeded = 0;
  let failed = 0;
  let newProducts = 0;

  try {
    const result = await searchTikTokShopByKeyword({
      keyword: opts.keyword,
      maxItems: opts.maxProducts ?? env.SCRAPE_PRODUCTS_PER_KEYWORD,
    });

    for (const product of result.products) {
      try {
        const r = await upsertTikTokShopProduct(product, opts.niche);
        succeeded++;
        if (r.isNew) newProducts++;
      } catch (err) {
        failed++;
        log.warn({ err: errMsg(err) }, "tiktok shop product upsert failed");
      }
    }

    await db
      .update(schema.scraperRuns)
      .set({
        status: succeeded === 0 ? "failed" : failed > succeeded ? "partial" : "success",
        itemsAttempted: result.products.length,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        costUsdMicros: Math.round(result.stats.costUsd * 1_000_000),
        durationMs: Date.now() - startTime,
        finishedAt: new Date(),
        raw: { apifyRunId: result.stats.apifyRunId, newProducts },
      })
      .where(eq(schema.scraperRuns.id, runId));

    log.info(
      { runId, keyword: opts.keyword, attempted: result.products.length, succeeded, failed, newProducts },
      "tiktok shop scrape done",
    );

    return {
      runId,
      attempted: result.products.length,
      succeeded,
      failed,
      newProducts,
      costUsd: result.stats.costUsd,
    };
  } catch (err) {
    await db
      .update(schema.scraperRuns)
      .set({
        status: "failed",
        errorMsg: errMsg(err),
        durationMs: Date.now() - startTime,
        finishedAt: new Date(),
      })
      .where(eq(schema.scraperRuns.id, runId));
    throw err;
  }
}

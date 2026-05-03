/**
 * High-level Shopee scrape runner — search a keyword, persist results,
 * audit-log the run.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";
import { searchByKeyword, BudgetExceededError } from "./apify-client.ts";
import { upsertShop, upsertProduct } from "./persist.ts";
import { clearSourceHealthAlerts } from "../../monitoring/source-health.ts";
import { scheduleSiteRebuild } from "../../web/site-builder.ts";
import type { Niche } from "./types.ts";

const log = child("shopee.runner");

export interface ScrapeRunOptions {
  keyword: string;
  niche?: Niche;
  maxProducts?: number;
}

export interface ScrapeRunResult {
  runId: number;
  attempted: number;
  succeeded: number;
  failed: number;
  newProducts: number;
  priceChanges: number;
  costUsd: number;
  apifyRunId?: string;
  skippedReason?: string;
}

export async function runShopeeScrape(opts: ScrapeRunOptions): Promise<ScrapeRunResult> {
  // Insert "running" row first so we have an audit trail even if it crashes
  const [runRow] = await db
    .insert(schema.scraperRuns)
    .values({
      scraper: "shopee_apify",
      target: `apify:${opts.keyword}`,
      status: "running",
    })
    .returning({ id: schema.scraperRuns.id });
  const runId = runRow!.id;

  log.info({ runId, keyword: opts.keyword, niche: opts.niche }, "shopee scrape start");

  try {
    const result = await searchByKeyword({
      keyword: opts.keyword,
      maxProducts: opts.maxProducts,
    });

    let succeeded = 0;
    let failed = 0;
    let newProducts = 0;
    let priceChanges = 0;

    // Persist shops first (need shop_id for product FK)
    const shopDbIds = new Map<string, number>();
    for (const [extId, shop] of result.shopsByExternalId) {
      try {
        const id = await upsertShop(shop);
        shopDbIds.set(extId, id);
      } catch (err) {
        log.warn({ shopExtId: extId, err: errMsg(err) }, "shop upsert failed");
      }
    }

    // Persist products
    for (const product of result.products) {
      try {
        const shopDbId = shopDbIds.get(product.shopExternalId);
        if (!shopDbId) {
          log.warn(
            { externalId: product.externalId, shopExtId: product.shopExternalId },
            "product skipped: shop not in batch",
          );
          failed++;
          continue;
        }
        const r = await upsertProduct(product, shopDbId, opts.niche);
        succeeded++;
        if (r.isNew) newProducts++;
        if (r.priceChanged) priceChanges++;
      } catch (err) {
        failed++;
        log.warn(
          { externalId: product.externalId, err: errMsg(err) },
          "product upsert failed",
        );
      }
    }

    // Mark run successful
    const finalStatus = succeeded === 0 ? "failed" : failed > succeeded ? "partial" : "success";
    await db
      .update(schema.scraperRuns)
      .set({
        status: finalStatus,
        itemsAttempted: result.products.length,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
        costUsdMicros: Math.round(result.stats.costUsd * 1_000_000),
        durationMs: result.stats.durationMs,
        finishedAt: new Date(),
        raw: { apifyRunId: result.stats.apifyRunId, newProducts, priceChanges },
      })
      .where(eq(schema.scraperRuns.id, runId));

    // Auto-resolve any open source-health alerts on successful runs,
    // and schedule a debounced static-site rebuild so the public site
    // reflects the new product/price data within ~5 min.
    if (finalStatus === "success") {
      try {
        await clearSourceHealthAlerts("shopee_apify");
      } catch (err) {
        log.warn({ err: errMsg(err) }, "failed to auto-clear source-health alerts");
      }
      // Fire-and-forget: rebuild errors are logged inside the scheduler.
      void scheduleSiteRebuild().catch(() => {});
    }

    log.info(
      {
        runId,
        keyword: opts.keyword,
        attempted: result.products.length,
        succeeded,
        failed,
        newProducts,
        priceChanges,
        costUsd: result.stats.costUsd.toFixed(4),
      },
      "shopee scrape done",
    );

    return {
      runId,
      attempted: result.products.length,
      succeeded,
      failed,
      newProducts,
      priceChanges,
      costUsd: result.stats.costUsd,
      apifyRunId: result.stats.apifyRunId,
    };
  } catch (err) {
    const isBudget = err instanceof BudgetExceededError;
    await db
      .update(schema.scraperRuns)
      .set({
        status: isBudget ? "skipped" : "failed",
        errorMsg: errMsg(err),
        finishedAt: new Date(),
      })
      .where(eq(schema.scraperRuns.id, runId));

    if (isBudget) {
      log.warn({ runId, keyword: opts.keyword }, "scrape skipped (budget)");
      return {
        runId,
        attempted: 0,
        succeeded: 0,
        failed: 0,
        newProducts: 0,
        priceChanges: 0,
        costUsd: 0,
        skippedReason: errMsg(err),
      };
    }

    log.error({ runId, keyword: opts.keyword, err: errMsg(err) }, "shopee scrape failed");
    throw err;
  }
}

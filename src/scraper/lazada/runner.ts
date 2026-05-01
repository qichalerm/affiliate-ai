/**
 * Lazada scrape orchestrator — mirrors src/scraper/shopee/runner.ts
 * but uses Lazada-specific endpoints + much slower pacing (Lazada's anti-bot is harder).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, sleep } from "../../lib/retry.ts";
import { env } from "../../lib/env.ts";
import { searchByKeyword, browseCategory, startSession, endSession, warmUpSession } from "./client.ts";
import { parseListItem, parseShopFromItem } from "./parser.ts";
import { upsertShop, upsertProduct } from "./persist.ts";
import { browseSessionPause } from "../stealth/rate-limiter.ts";

const log = child("lazada.runner");

export interface LazadaRunOptions {
  keyword?: string;
  categorySlug?: string; // e.g. "shop-headphones-headsets"
  maxPages?: number;     // 1-10
  maxProducts?: number;
}

export interface LazadaRunResult {
  scraperRunId: number;
  itemsAttempted: number;
  itemsSucceeded: number;
  itemsFailed: number;
  durationMs: number;
}

export async function runLazadaScrape(opts: LazadaRunOptions): Promise<LazadaRunResult> {
  if (!opts.keyword && !opts.categorySlug) {
    throw new Error("runLazadaScrape: keyword or categorySlug required");
  }
  const target = opts.keyword ?? `cat:${opts.categorySlug}`;
  const maxPages = Math.min(opts.maxPages ?? 2, 10);
  const maxProducts = opts.maxProducts ?? 40;

  const [run] = await db
    .insert(schema.scraperRuns)
    .values({ scraper: "lazada", target, status: "running" })
    .returning({ id: schema.scraperRuns.id });
  const runId = run.id;
  const startedAt = Date.now();

  startSession(`run_${runId}`);
  await warmUpSession();
  log.info({ runId, target, maxPages, maxProducts }, "lazada scrape start");

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  const seenShops = new Map<string, number>();

  try {
    for (let page = 1; page <= maxPages; page++) {
      let resp;
      try {
        resp = opts.keyword
          ? await searchByKeyword(opts.keyword, { page, sortBy: "popularity" })
          : await browseCategory(opts.categorySlug!, { page, sortBy: "popularity" });
      } catch (err) {
        log.warn({ page, err: errMsg(err) }, "page fetch failed");
        break;
      }

      const items = resp.mods?.listItems ?? [];
      if (items.length === 0) {
        log.info({ page }, "no more items");
        break;
      }

      // Polite pause between page navigations (browse-like behavior)
      if (page > 1) await browseSessionPause();

      for (const raw of items) {
        if (succeeded >= maxProducts) break;
        attempted++;
        try {
          const product = parseListItem(raw);
          if (!shouldIngest(product)) continue;

          let shopDbId = seenShops.get(product.shopExternalId);
          if (!shopDbId) {
            const shop = parseShopFromItem(raw);
            shopDbId = await upsertShop(shop);
            seenShops.set(product.shopExternalId, shopDbId);
          }

          await upsertProduct(product, shopDbId);
          succeeded++;
        } catch (err) {
          failed++;
          log.debug({ err: errMsg(err) }, "lazada item failed");
        }
      }
      if (succeeded >= maxProducts) break;
    }
  } catch (err) {
    await db
      .update(schema.scraperRuns)
      .set({
        status: "failed",
        errorMessage: errMsg(err),
        finishedAt: new Date(),
        durationMs: Date.now() - startedAt,
        itemsAttempted: attempted,
        itemsSucceeded: succeeded,
        itemsFailed: failed,
      })
      .where(eq(schema.scraperRuns.id, runId));
    endSession();
    throw err;
  }

  const durationMs = Date.now() - startedAt;
  await db
    .update(schema.scraperRuns)
    .set({
      status: "success",
      itemsAttempted: attempted,
      itemsSucceeded: succeeded,
      itemsFailed: failed,
      durationMs,
      finishedAt: new Date(),
    })
    .where(eq(schema.scraperRuns.id, runId));

  endSession();
  log.info({ runId, attempted, succeeded, failed, durationMs }, "lazada scrape done");

  return {
    scraperRunId: runId,
    itemsAttempted: attempted,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
    durationMs,
  };
}

function shouldIngest(p: import("./types.ts").LazadaProduct): boolean {
  if (!p.name || p.name.length < 4) return false;
  if (p.currentPriceSatang <= 0) return false;
  if ((p.rating ?? 0) > 0 && (p.rating ?? 0) < env.MIN_PRODUCT_RATING) {
    if ((p.ratingCount ?? 0) >= 20) return false;
  }
  if ((p.soldCount ?? 0) < env.MIN_PRODUCT_SOLD && (p.ratingCount ?? 0) < 10) return false;
  return true;
}

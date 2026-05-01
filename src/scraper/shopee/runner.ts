/**
 * Orchestrates a full Shopee scraping run.
 * - Search/browse → list of products
 * - Per product: fetch detail + reviews
 * - Persist with idempotent upserts
 * - Log run stats to scraper_runs table
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, sleep } from "../../lib/retry.ts";
import { env } from "../../lib/env.ts";
import {
  searchByKeyword,
  browseCategory,
  getItemDetail,
  getShopDetail,
  getRatings,
} from "./client.ts";
import {
  parseItemBasic,
  parseItemDetail,
  parseShop,
  parseReviews,
} from "./parser.ts";
import { upsertShop, upsertProduct, insertReviews } from "./persist.ts";

const log = child("shopee.runner");

export interface RunOptions {
  /** Either keyword OR shopeeCategoryId. */
  keyword?: string;
  shopeeCategoryId?: number;
  /** Hard cap on products to ingest. */
  maxProducts?: number;
  /** Whether to fetch full details + reviews (slower, more accurate). */
  fetchDetails?: boolean;
  /** Reviews per product to fetch (Shopee limit ~20 per call). */
  reviewsPerProduct?: number;
  /** Sort: 5=Top sales (default), 18=Rating, 12=Price asc */
  orderBy?: number;
}

export interface RunResult {
  scraperRunId: number;
  itemsAttempted: number;
  itemsSucceeded: number;
  itemsFailed: number;
  durationMs: number;
}

export async function runShopeeScrape(opts: RunOptions): Promise<RunResult> {
  if (!opts.keyword && !opts.shopeeCategoryId) {
    throw new Error("runShopeeScrape: keyword or shopeeCategoryId required");
  }
  const target = opts.keyword ?? `cat:${opts.shopeeCategoryId}`;
  const maxProducts = opts.maxProducts ?? 60;

  const [run] = await db
    .insert(schema.scraperRuns)
    .values({
      scraper: "shopee",
      target,
      status: "running",
    })
    .returning({ id: schema.scraperRuns.id });
  const runId = run.id;
  const startedAt = Date.now();

  log.info({ runId, target, maxProducts }, "shopee scrape start");

  let attempted = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    // 1. List items
    const search = opts.keyword
      ? await searchByKeyword(opts.keyword, {
          limit: Math.min(maxProducts, 60),
          orderBy: opts.orderBy ?? 5,
        })
      : await browseCategory(opts.shopeeCategoryId!, {
          limit: Math.min(maxProducts, 60),
          orderBy: opts.orderBy ?? 5,
        });

    const items = (search.items ?? []).slice(0, maxProducts);
    log.info({ runId, total: items.length }, "fetched product list");

    // 2. Process each product
    const seenShops = new Map<string, number>();
    for (const wrapper of items) {
      attempted++;
      try {
        const productBasic = parseItemBasic(wrapper.item_basic);

        // Skip products that violate minimum quality bar (compliance Layer 11 first pass)
        if (!shouldIngest(productBasic)) {
          continue;
        }

        // Shop
        let shopDbId = seenShops.get(productBasic.shopExternalId);
        if (!shopDbId) {
          const shopDetail = await getShopDetail(Number(productBasic.shopExternalId));
          const shop = parseShop(shopDetail);
          shopDbId = await upsertShop(shop);
          seenShops.set(productBasic.shopExternalId, shopDbId);
        }

        // Product (fetch full details for richer data)
        let product = productBasic;
        if (opts.fetchDetails ?? true) {
          try {
            const detail = await getItemDetail(
              Number(productBasic.externalId),
              Number(productBasic.shopExternalId),
            );
            product = parseItemDetail(detail);
          } catch (err) {
            log.warn(
              { itemId: productBasic.externalId, err: errMsg(err) },
              "detail fetch failed, falling back to basic",
            );
          }
        }

        const { id: productDbId, isNew } = await upsertProduct(product, shopDbId);

        // Reviews
        if ((opts.reviewsPerProduct ?? 20) > 0 && (product.ratingCount ?? 0) > 0) {
          try {
            const ratings = await getRatings(
              Number(productBasic.externalId),
              Number(productBasic.shopExternalId),
              { limit: opts.reviewsPerProduct ?? 20 },
            );
            const reviews = parseReviews(ratings);
            if (reviews.length > 0) {
              await insertReviews(productDbId, reviews);
            }
          } catch (err) {
            log.debug(
              { itemId: productBasic.externalId, err: errMsg(err) },
              "review fetch skipped",
            );
          }
        }

        succeeded++;
        if (isNew && env.DEBUG_VERBOSE_LOGGING) {
          log.info(
            { productDbId, name: product.name, price: product.currentPriceSatang },
            "+ new product",
          );
        }

        await sleep(200 + Math.random() * 400);
      } catch (err) {
        failed++;
        log.error({ err: errMsg(err) }, "product processing failed");
      }
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

  log.info(
    { runId, attempted, succeeded, failed, durationMs },
    "shopee scrape done",
  );

  return {
    scraperRunId: runId,
    itemsAttempted: attempted,
    itemsSucceeded: succeeded,
    itemsFailed: failed,
    durationMs,
  };
}

/**
 * Quality gate before persistence.
 * Avoids polluting DB with low-signal products.
 */
function shouldIngest(p: import("./types.ts").ShopeeProduct): boolean {
  if (!p.name || p.name.length < 4) return false;
  if (p.currentPriceSatang <= 0) return false;
  if ((p.rating ?? 0) > 0 && (p.rating ?? 0) < env.MIN_PRODUCT_RATING) {
    if ((p.ratingCount ?? 0) >= 20) return false; // ratings are statistically meaningful
  }
  if ((p.soldCount ?? 0) < env.MIN_PRODUCT_SOLD && (p.ratingCount ?? 0) < 10) return false;
  return true;
}

/**
 * Apify TikTok Shop scraper client — Sprint 26.
 *
 * Generic Apify wrapper. Input/output schemas vary per actor — when
 * activating, you'll likely need to refine `input` shape and `parseItem`
 * mapping to match whichever actor TIKTOK_SHOP_ACTOR_ID points at.
 *
 * Conservative defaults assume an actor that takes:
 *   { keyword: string, country: "th", maxItems: number, proxyCountry: "TH" }
 * and emits items with at least:
 *   { product_id, shop_id, name, price (BAHT), rating, sold_count, image_url }
 */

import { sql } from "drizzle-orm";
import { db, schema } from "../../lib/db.ts";
import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, retry, sleep } from "../../lib/retry.ts";
import type { ApifyTikTokSearchResult, TikTokShopProduct } from "./types.ts";

const log = child("tiktok-shop.apify");
const APIFY_BASE = "https://api.apify.com/v2";

interface ApifyRun {
  id: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "ABORTED";
  defaultDatasetId: string;
  usage?: { totalUsd?: number };
  usageTotalUsd?: number;
}

export async function searchTikTokShopByKeyword(opts: {
  keyword: string;
  maxItems: number;
}): Promise<ApifyTikTokSearchResult> {
  if (!env.APIFY_TOKEN || !env.TIKTOK_SHOP_ACTOR_ID) {
    throw new Error("APIFY_TOKEN + TIKTOK_SHOP_ACTOR_ID required");
  }

  // Soft budget check — share APIFY_DAILY_BUDGET_USD with Shopee scraper
  const todaySpend = await todayApifySpendUsd();
  if (todaySpend >= env.APIFY_DAILY_BUDGET_USD) {
    throw new Error(`Apify daily budget exceeded: $${todaySpend.toFixed(4)} of $${env.APIFY_DAILY_BUDGET_USD}`);
  }

  const start = Date.now();
  const actorId = env.TIKTOK_SHOP_ACTOR_ID.replace("/", "~");

  // Generic input — refine when actor is chosen
  const input = {
    keyword: opts.keyword,
    country: "th",
    maxItems: opts.maxItems,
    proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"], apifyProxyCountry: "TH" },
  };

  log.info({ keyword: opts.keyword, maxItems: opts.maxItems, actor: env.TIKTOK_SHOP_ACTOR_ID }, "tiktok shop scrape start");

  // Start actor run
  const runRes = await fetch(`${APIFY_BASE}/acts/${actorId}/runs?token=${env.APIFY_TOKEN}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!runRes.ok) {
    throw new Error(`Apify start ${runRes.status}: ${await runRes.text().catch(() => "")}`);
  }
  let run = ((await runRes.json()) as { data: ApifyRun }).data;

  // Poll until done (max 5 min)
  const POLL_INTERVAL = 5_000;
  const MAX_WAIT = 5 * 60 * 1000;
  while (Date.now() - start < MAX_WAIT && (run.status === "READY" || run.status === "RUNNING")) {
    await sleep(POLL_INTERVAL);
    const statusRes = await fetch(`${APIFY_BASE}/actor-runs/${run.id}?token=${env.APIFY_TOKEN}`);
    run = ((await statusRes.json()) as { data: ApifyRun }).data;
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify run ${run.id} ended with status ${run.status}`);
  }

  // Fetch dataset
  const datasetRes = await retry(
    () => fetch(`${APIFY_BASE}/datasets/${run.defaultDatasetId}/items?token=${env.APIFY_TOKEN}&format=json`),
    { attempts: 3, baseDelayMs: 1000 },
  );
  const items = (await datasetRes.json()) as Array<Record<string, unknown>>;

  const products: TikTokShopProduct[] = items
    .map((item) => parseItem(item))
    .filter((p): p is TikTokShopProduct => p !== null);

  const costUsd = run.usageTotalUsd ?? run.usage?.totalUsd ?? 0;

  log.info(
    { runId: run.id, items: items.length, parsed: products.length, costUsd: costUsd.toFixed(4) },
    "tiktok shop scrape done",
  );

  return {
    products,
    stats: {
      apifyRunId: run.id,
      costUsd,
      durationMs: Date.now() - start,
    },
  };
}

/** Pluggable item parser — refine for the chosen actor's output schema. */
function parseItem(item: Record<string, unknown>): TikTokShopProduct | null {
  // Best-effort generic mapping. Adjust field names based on actor docs.
  const externalId = String(item.product_id ?? item.id ?? "");
  if (!externalId) return null;
  const priceBaht = Number(item.price ?? item.current_price ?? 0);
  if (!priceBaht || priceBaht <= 0) return null;

  return {
    externalId,
    shopExternalId: item.shop_id ? String(item.shop_id) : null,
    shopName: item.shop_name ? String(item.shop_name) : null,
    name: String(item.name ?? item.title ?? ""),
    brand: item.brand ? String(item.brand) : null,
    description: item.description ? String(item.description) : null,
    primaryImage: item.image_url ? String(item.image_url) : (item.image ? String(item.image) : null),
    imageUrls: Array.isArray(item.images) ? item.images.map(String) : undefined,
    currentPriceSatang: Math.round(priceBaht * 100),
    originalPriceSatang: item.original_price ? Math.round(Number(item.original_price) * 100) : null,
    discountPercent: item.discount_pct ? Number(item.discount_pct) / 100 : null,
    rating: item.rating ? Number(item.rating) : null,
    ratingCount: item.rating_count ? Number(item.rating_count) : null,
    soldCount: item.sold_count ? Number(item.sold_count) : null,
    raw: item,
  };
}

async function todayApifySpendUsd(): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [row] = await db.execute<{ totalMicros: number; [k: string]: unknown }>(sql`
    SELECT COALESCE(SUM(cost_usd_micros), 0)::bigint AS "totalMicros"
    FROM scraper_runs
    WHERE started_at >= ${today.toISOString()}::timestamptz
  `);
  return row?.totalMicros ? Number(row.totalMicros) / 1_000_000 : 0;
}

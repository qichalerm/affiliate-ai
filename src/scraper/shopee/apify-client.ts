/**
 * Apify-backed Shopee scraper.
 *
 * Why Apify, not the public Shopee API?
 *  - Shopee Thailand's WAF (Cloudflare + Akamai-class) + app-layer signed-token check
 *    blocks both DC and residential IPs even via Playwright with warm cookies.
 *  - error 90309999 is the app-layer block (af-ac-enc-dat token mismatch).
 *  - We empirically tested: IPRoyal residential, Scrapfly ASP+render, Playwright Chromium
 *    — all return 0 items. Apify's xtracto/shopee-scraper consistently returns real data.
 *
 * Pricing (xtracto): $0.05/GB on actor start + $0.02 per result. Effective ~$20/1k products
 * for runs with 1,000+ items (start cost amortizes).
 */

import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, sleep } from "../../lib/retry.ts";
import { db, schema } from "../../lib/db.ts";
import { sql } from "drizzle-orm";
import type { ShopeeProduct, ShopeeShop } from "./types.ts";

const log = child("shopee.apify");
const APIFY_BASE = "https://api.apify.com/v2";

interface ApifyRun {
  id: string;
  status: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMING-OUT" | "TIMED-OUT" | "ABORTING" | "ABORTED";
  defaultDatasetId: string;
  startedAt: string;
  finishedAt?: string;
  usageTotalUsd?: number;
}

/**
 * Raw shape returned by xtracto/shopee-scraper.
 * Field names differ between basic mode (`name`, `image_url`) and fetchDetail=true
 * mode (`title`, `images[]`, plus `models[]`/`shop` objects). Mapper handles both.
 */
interface ApifyShopeeItem {
  shop_id: number | string;
  item_id: number | string;
  // Basic-mode names ↓
  name?: string;
  image_url?: string;
  // Detail-mode names ↓
  title?: string;
  images?: string[];
  // Common fields
  url?: string;
  price?: number;
  original_price?: number;
  discount_pct?: number;
  rating?: number;
  rating_count?: number;
  sold_count?: number;
  location?: string;
  is_mall?: boolean;
  currency?: string;
  brand?: string;
  description?: string;
  shop_name?: string;
  shop_rating?: number;
  shop_followers?: number;
  shop_response_rate?: number;
  // Detail-mode nested shop (when fetchDetail=true)
  shop?: {
    shopid?: number;
    name?: string;
    is_official_shop?: boolean | number;
    rating_star?: number;
    follower_count?: number;
    response_rate?: number;
    place?: string;
  };
  models?: Array<{ modelid: number; name: string; price: number; stock: number }>;
}

export interface ApifyShopeeRunStats {
  costUsd: number;
  durationMs: number;
  itemCount: number;
  apifyRunId: string;
}

export interface ApifySearchResult {
  products: ShopeeProduct[];
  shopsByExternalId: Map<string, ShopeeShop>;
  stats: ApifyShopeeRunStats;
}

class BudgetExceededError extends Error {
  constructor(public readonly spentUsd: number, public readonly cap: number) {
    super(`Apify daily budget exceeded: spent $${spentUsd.toFixed(4)} of $${cap.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Sum of `usageTotalUsd` for all Apify costs already recorded today (UTC date).
 * Recorded in `scraper_runs.cost_usd_micros` (we store $·1e6 for integer-precision).
 */
async function todaySpendUsd(): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const result = await db
    .select({
      total: sql<string>`COALESCE(SUM(cost_usd_micros), 0)::text`,
    })
    .from(schema.scraperRuns)
    .where(
      sql`${schema.scraperRuns.startedAt} >= ${todayStartIso}::timestamptz AND ${schema.scraperRuns.scraper} LIKE 'shopee%'`,
    );
  const microUsd = Number(result[0]?.total ?? 0);
  return microUsd / 1_000_000;
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
    throw new Error(`Apify startRun ${res.status}: ${(await res.text()).slice(0, 400)}`);
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

async function getDatasetItems(datasetId: string, limit: number): Promise<ApifyShopeeItem[]> {
  const url = `${APIFY_BASE}/datasets/${datasetId}/items?clean=1&limit=${limit}&token=${env.APIFY_TOKEN}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Apify getDataset ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ApifyShopeeItem[];
}

async function waitForRun(runId: string, timeoutMs = 300_000): Promise<ApifyRun> {
  const t0 = Date.now();
  let lastStatus = "";
  let pollIntervalMs = 3_000;
  while (Date.now() - t0 < timeoutMs) {
    const run = await getRun(runId);
    if (run.status !== lastStatus) {
      log.debug({ runId, status: run.status, elapsedSec: ((Date.now() - t0) / 1000).toFixed(0) }, "apify run status");
      lastStatus = run.status;
    }
    if (run.status === "SUCCEEDED") return run;
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new Error(`Apify run ${runId} ended in ${run.status}`);
    }
    await sleep(pollIntervalMs);
    pollIntervalMs = Math.min(pollIntervalMs + 1000, 8_000); // gentle backoff
  }
  throw new Error(`Apify run ${runId} timeout after ${timeoutMs}ms`);
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export interface SearchOptions {
  /** Max products. Apify charges $0.02 per result. */
  maxProducts?: number;
  /** Sort: 'sales' (default), 'relevance', 'latest', 'price_asc', 'price_desc', 'rating' */
  sort?: "sales" | "relevance" | "latest" | "price_asc" | "price_desc" | "rating";
  /** Whether to fetch full product details (slower + more expensive). */
  fetchDetail?: boolean;
}

/**
 * Run xtracto/shopee-scraper for a keyword on Shopee Thailand.
 * Returns parsed products + shops, plus run stats (cost, duration).
 *
 * Throws BudgetExceededError if today's Apify spend would exceed APIFY_DAILY_BUDGET_USD.
 */
export async function searchByKeywordViaApify(
  keyword: string,
  opts: SearchOptions = {},
): Promise<ApifySearchResult> {
  if (!env.APIFY_TOKEN) throw new Error("APIFY_TOKEN not configured");

  const maxProducts = Math.min(opts.maxProducts ?? 60, 1000);
  // Conservative pre-flight cost estimate: $0.20 actor-start + $0.02 per result
  const estimateUsd = 0.2 + maxProducts * 0.02;

  const spent = await todaySpendUsd();
  if (spent + estimateUsd > env.APIFY_DAILY_BUDGET_USD) {
    throw new BudgetExceededError(spent + estimateUsd, env.APIFY_DAILY_BUDGET_USD);
  }

  const input = {
    country: "th",
    mode: "keyword",
    keyword,
    maxProducts,
    sort: opts.sort ?? "sales",
    delay: 1.0,
    fetchDetail: opts.fetchDetail ?? false,
  };

  log.info({ keyword, maxProducts, estimateUsd }, "apify shopee scrape start");
  const t0 = Date.now();
  const run = await startActorRun(input);
  const finished = await waitForRun(run.id, 300_000);
  const items = await getDatasetItems(finished.defaultDatasetId, maxProducts);

  const stats: ApifyShopeeRunStats = {
    costUsd: finished.usageTotalUsd ?? 0,
    durationMs: Date.now() - t0,
    itemCount: items.length,
    apifyRunId: run.id,
  };
  log.info(
    { ...stats, runId: run.id, keyword },
    "apify shopee scrape done",
  );

  if (items.length > 0) {
    log.debug({ sampleItemKeys: Object.keys(items[0] ?? {}) }, "apify item shape");
  }
  const { products, shopsByExternalId } = mapApifyItems(items);
  if (items.length > 0 && products.length === 0) {
    log.warn(
      { itemCount: items.length, sample: JSON.stringify(items[0]).slice(0, 800) },
      "all apify items filtered out — check field names",
    );
  }
  return { products, shopsByExternalId, stats };
}

export { BudgetExceededError };

/* -------------------------------------------------------------------------- */
/* Mapping                                                                    */
/* -------------------------------------------------------------------------- */

function bahtToSatang(baht: number | undefined): number | undefined {
  if (baht === undefined || baht === null || !Number.isFinite(baht)) return undefined;
  return Math.round(baht * 100);
}

/** Postgres TEXT/JSONB cannot contain NUL bytes — Apify scraped data sometimes includes them. */
function sanitize<T extends string | undefined>(s: T): T {
  if (typeof s !== "string") return s;
  return s.replace(/\x00/g, "") as T;
}

/** Recursively strip NUL bytes from any value (used for raw JSONB blob). */
function deepSanitize<T>(v: T): T {
  if (typeof v === "string") return v.replace(/\x00/g, "") as unknown as T;
  if (Array.isArray(v)) return v.map(deepSanitize) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = deepSanitize(val);
    return out as unknown as T;
  }
  return v;
}

function mapApifyItems(items: ApifyShopeeItem[]): {
  products: ShopeeProduct[];
  shopsByExternalId: Map<string, ShopeeShop>;
} {
  const products: ShopeeProduct[] = [];
  const shopsByExternalId = new Map<string, ShopeeShop>();

  for (const it of items) {
    const externalId = it.item_id ? String(it.item_id) : "";
    const shopExternalId = it.shop_id ? String(it.shop_id) : "";
    const name = it.title ?? it.name;
    if (!externalId || !shopExternalId || !name) continue;

    const currentPriceSatang = bahtToSatang(it.price) ?? 0;
    const originalPriceSatang = bahtToSatang(it.original_price);
    const discountPercent =
      typeof it.discount_pct === "number" && it.discount_pct > 0
        ? it.discount_pct / 100
        : originalPriceSatang && originalPriceSatang > currentPriceSatang
          ? (originalPriceSatang - currentPriceSatang) / originalPriceSatang
          : undefined;

    const imageUrls = it.images?.length ? it.images : it.image_url ? [it.image_url] : [];

    const product: ShopeeProduct = {
      externalId,
      shopExternalId,
      name: sanitize(name)!,
      brand: sanitize(it.brand) || undefined,
      description: sanitize(it.description)?.slice(0, 6000),
      primaryImage: imageUrls[0],
      imageUrls,
      currentPriceSatang,
      originalPriceSatang,
      discountPercent,
      rating: typeof it.rating === "number" ? Math.round(it.rating * 10) / 10 : undefined,
      ratingCount: it.rating_count ?? undefined,
      soldCount: it.sold_count ?? undefined,
      hasFreeShipping: false, // xtracto schema doesn't expose this; default false
      hasVoucher: false,
      raw: deepSanitize(it),
    };
    products.push(product);

    if (!shopsByExternalId.has(shopExternalId)) {
      // Detail mode wraps shop info; basic mode flattens onto item
      const shopName = it.shop?.name ?? it.shop_name ?? `shop_${shopExternalId}`;
      const isMall = Boolean(it.shop?.is_official_shop ?? it.is_mall);
      shopsByExternalId.set(shopExternalId, {
        externalId: shopExternalId,
        name: shopName,
        isMall,
        isPreferred: false,
        rating: it.shop?.rating_star ?? it.shop_rating,
        followerCount: it.shop?.follower_count ?? it.shop_followers,
        responseRate: it.shop?.response_rate ?? it.shop_response_rate,
        shipFromLocation: it.shop?.place ?? it.location ?? undefined,
        raw: { source: "apify" },
      });
    }
  }

  return { products, shopsByExternalId };
}

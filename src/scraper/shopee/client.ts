/**
 * Shopee Thailand HTTP client.
 *
 * Targets Shopee's public web JSON endpoints (the same ones the website calls).
 * Endpoints are subject to change; on schema drift, fall back to Playwright (see runner.ts).
 *
 * NOTE on rate limits:
 * - Shopee enforces per-IP throttling. Use proxy rotation for sustained scraping.
 * - Add jitter between requests; don't burst.
 * - Honor Retry-After when present.
 */

import { env } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { retry, sleep, errMsg } from "../../lib/retry.ts";
import {
  pickFingerprint,
  fingerprintToHeaders,
  type SessionFingerprint,
} from "../stealth/user-agents.ts";
import { proxyPool } from "../stealth/proxy-pool.ts";
import { rateLimit } from "../stealth/rate-limiter.ts";

const log = child("shopee.client");

const SHOPEE_BASE = "https://shopee.co.th";

/**
 * Per-session fingerprint — pinned for the lifetime of the scrape run.
 * Avoids the obvious "single client switching browsers mid-session" tell.
 */
let currentFingerprint: SessionFingerprint | null = null;
let currentSessionId: string | null = null;

export function startSession(sessionId?: string): void {
  currentSessionId = sessionId ?? `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  currentFingerprint = pickFingerprint({ preferDesktop: true });
  log.debug(
    { sessionId: currentSessionId, platform: currentFingerprint.platform },
    "scrape session started",
  );
}

export function endSession(): void {
  currentSessionId = null;
  currentFingerprint = null;
}

function ensureSession(): SessionFingerprint {
  if (!currentFingerprint) startSession();
  return currentFingerprint!;
}

/**
 * Build headers for a Shopee request — mixes real browser fingerprint + Shopee-specific headers.
 */
function shopeeHeaders(referer = `${SHOPEE_BASE}/`): HeadersInit {
  const fp = ensureSession();
  return {
    ...fingerprintToHeaders(fp, referer),
    Accept: "application/json",
    "x-api-source": "pc",
    "x-shopee-language": "th",
    "x-requested-with": "XMLHttpRequest",
    Origin: SHOPEE_BASE,
  };
}

interface FetchOptions {
  timeoutMs?: number;
  proxy?: string;
  referer?: string;
}

/**
 * Low-level fetch wrapper.
 * - Token-bucket rate limit (per host)
 * - Stealth headers (UA fingerprint + Sec-CH-UA + sticky session)
 * - Optional proxy rotation (Webshare residential, if configured)
 * - Retry/backoff on transient errors
 * - Honors Retry-After on 429
 */
async function shopeeFetch<T>(path: string, opts: FetchOptions = {}): Promise<T> {
  // Apply rate limit (with human pauses)
  await rateLimit("shopee").acquire();

  const url = path.startsWith("http") ? path : `${SHOPEE_BASE}${path}`;
  const timeoutMs = opts.timeoutMs ?? 15_000;

  const result = await retry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);

      // Pick proxy (sticky to current session) — null if not configured
      const proxy = await proxyPool.pick(currentSessionId ?? undefined);

      try {
        // Bun-native proxy support
        const fetchInit: RequestInit & { proxy?: string } = {
          headers: shopeeHeaders(opts.referer),
          signal: ctrl.signal,
        };
        if (proxy) fetchInit.proxy = proxy.url;

        const res = await fetch(url, fetchInit);

        if (res.status === 429) {
          if (proxy) proxyPool.recordResult(proxy.id, false);
          const retryAfter = res.headers.get("retry-after");
          const wait = retryAfter ? Number(retryAfter) * 1000 : 60_000;
          log.warn({ url, wait, proxy: proxy?.host }, "rate limited; backing off");
          await sleep(wait);
          throw new Error("rate-limited");
        }
        if (res.status === 403 || res.status === 451) {
          // Possible IP block — rotate fingerprint + proxy
          if (proxy) proxyPool.recordResult(proxy.id, false);
          log.warn({ url, status: res.status, proxy: proxy?.host }, "blocked; rotating session");
          startSession(); // new fingerprint
          const body = await res.text();
          throw new ShopeeHttpError(res.status, body.slice(0, 500), url);
        }
        if (!res.ok) {
          if (proxy) proxyPool.recordResult(proxy.id, false);
          const body = await res.text();
          throw new ShopeeHttpError(res.status, body.slice(0, 500), url);
        }
        if (proxy) proxyPool.recordResult(proxy.id, true);
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 2000,
      maxDelayMs: 60_000,
      shouldRetry: (err) => {
        if (err instanceof ShopeeHttpError) {
          // Don't retry on permanent blocks (403 with WAF body)
          return err.status >= 500 || err.status === 429;
        }
        return true; // network errors
      },
      onAttempt: (attempt, err) =>
        log.warn({ url, attempt, err: errMsg(err) }, "shopee fetch retry"),
    },
  );

  return result;
}

export class ShopeeHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Shopee HTTP ${status}: ${url}`);
    this.name = "ShopeeHttpError";
  }
}

/* ===================================================================
 * Endpoints
 * =================================================================== */

export interface RawSearchResponse {
  items?: Array<{ item_basic: RawItemBasic; adsid?: number }>;
  total_count?: number;
  nomore?: boolean;
}

export interface RawItemBasic {
  itemid: number;
  shopid: number;
  name: string;
  brand?: string;
  image: string;
  images: string[];
  currency: string;
  stock: number;
  status: number;
  ctime: number;
  sold: number;
  historical_sold?: number;
  liked_count: number;
  view_count?: number;
  catid: number;
  price: number; // micro (price * 100000)
  price_min: number;
  price_max: number;
  price_before_discount?: number;
  raw_discount?: number;
  item_rating?: { rating_star: number; rating_count: number[]; rcount_with_context: number };
  shopee_verified: boolean;
  is_official_shop: boolean;
  is_preferred_plus_seller: boolean;
  show_free_shipping?: boolean;
  voucher_info?: unknown;
  flag?: number;
  cb_option?: number;
  badge_icon_type?: number;
  shop_location?: string;
  description?: string;
  tier_variations?: unknown;
}

export interface RawItemDetail {
  data: {
    item: RawItemBasic & {
      description: string;
      attributes?: Array<{ name: string; value: string }>;
      models?: Array<{
        modelid: number;
        name: string;
        price: number;
        stock: number;
      }>;
    };
  };
}

export interface RawShopDetail {
  data: {
    shopid: number;
    name: string;
    is_official_shop: number;
    is_shopee_verified: number;
    rating_star: number;
    rating_good: number;
    rating_bad: number;
    rating_normal: number;
    response_rate: number;
    response_time: number;
    item_count: number;
    follower_count: number;
    place: string;
    ctime: number;
  };
}

export interface RawRatingResponse {
  data: {
    ratings: Array<{
      cmtid: number;
      rating_star: number;
      comment: string;
      author_username: string;
      mtime: number;
      tags?: string[];
      images?: string[];
      videos?: unknown[];
    }>;
  };
}

/**
 * Search products by keyword.
 */
export async function searchByKeyword(
  keyword: string,
  options: { limit?: number; offset?: number; orderBy?: number; mallOnly?: boolean } = {},
): Promise<RawSearchResponse> {
  const params = new URLSearchParams({
    by: String(options.orderBy ?? 5), // 5 = Top sales
    keyword,
    limit: String(options.limit ?? 60),
    newest: String(options.offset ?? 0),
    order: "desc",
    page_type: "search",
    scenario: "PAGE_GLOBAL_SEARCH",
    version: "2",
  });
  if (options.mallOnly) params.set("filter_sort", "official_mall");
  return shopeeFetch<RawSearchResponse>(`/api/v4/search/search_items?${params}`);
}

/**
 * Browse products in a category.
 */
export async function browseCategory(
  shopeeCategoryId: number,
  options: { limit?: number; offset?: number; orderBy?: number } = {},
): Promise<RawSearchResponse> {
  const params = new URLSearchParams({
    by: String(options.orderBy ?? 5),
    limit: String(options.limit ?? 60),
    newest: String(options.offset ?? 0),
    order: "desc",
    page_type: "search",
    scenario: "PAGE_CATEGORY",
    version: "2",
    match_id: String(shopeeCategoryId),
  });
  return shopeeFetch<RawSearchResponse>(`/api/v4/search/search_items?${params}`);
}

/**
 * Get full product details.
 */
export async function getItemDetail(itemId: number, shopId: number): Promise<RawItemDetail> {
  return shopeeFetch<RawItemDetail>(
    `/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
    { referer: `${SHOPEE_BASE}/product/${shopId}/${itemId}` },
  );
}

/**
 * Get shop details.
 */
export async function getShopDetail(shopId: number): Promise<RawShopDetail> {
  return shopeeFetch<RawShopDetail>(`/api/v4/shop/get_shop_detail?shopid=${shopId}`);
}

/**
 * Get product reviews.
 */
export async function getRatings(
  itemId: number,
  shopId: number,
  options: { limit?: number; offset?: number; filter?: number; type?: number } = {},
): Promise<RawRatingResponse> {
  const params = new URLSearchParams({
    itemid: String(itemId),
    shopid: String(shopId),
    limit: String(options.limit ?? 20),
    offset: String(options.offset ?? 0),
    filter: String(options.filter ?? 0),
    flag: "1",
    type: String(options.type ?? 0),
  });
  return shopeeFetch<RawRatingResponse>(
    `/api/v2/item/get_ratings?${params}`,
    { referer: `${SHOPEE_BASE}/product/${shopId}/${itemId}` },
  );
}

/**
 * Build affiliate-tagged Shopee URL.
 * Shopee URL: https://shopee.co.th/product/{shopId}/{itemId}?af_sub1=...&affiliate_id=...
 */
export function buildAffiliateUrl(
  itemId: number | string,
  shopId: number | string,
  subId: string,
): string {
  const params = new URLSearchParams();
  params.set("af_sub1", subId);
  if (env.SHOPEE_AFFILIATE_ID) params.set("affiliate_id", env.SHOPEE_AFFILIATE_ID);
  if (env.SHOPEE_TRACKING_ID) params.set("af_sub_pub", env.SHOPEE_TRACKING_ID);
  return `${SHOPEE_BASE}/product/${shopId}/${itemId}?${params}`;
}

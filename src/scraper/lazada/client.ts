/**
 * Lazada Thailand HTTP client.
 *
 * Strategy:
 *  - Use Lazada's public AJAX/JSON endpoints (used by their own web app)
 *  - Lazada is more aggressive with anti-bot than Shopee — depend on stealth layer + adaptive throttle
 *  - Catalog endpoint: /catalog/?ajax=true&_keyori=ss&from=input&...
 *  - Item detail: parsed from product page (no clean JSON API)
 *
 * NOTE: Lazada blocks aggressive scraping. Use SLOWER pacing than Shopee
 * and consider Playwright fallback for hard-to-parse pages.
 */

import { child } from "../../lib/logger.ts";
import { retry, sleep, errMsg } from "../../lib/retry.ts";
import {
  pickFingerprint,
  fingerprintToHeaders,
  type SessionFingerprint,
} from "../stealth/user-agents.ts";
import { proxyPool } from "../stealth/proxy-pool.ts";
import { rateLimit } from "../stealth/rate-limiter.ts";
import { recordResult, waitForThrottle } from "../stealth/adaptive-throttle.ts";
import { getJar, ingestSetCookie, buildCookieHeader, warmUp, clearJar } from "../stealth/cookie-jar.ts";

const log = child("lazada.client");

const LAZADA_BASE = "https://www.lazada.co.th";

let currentFingerprint: SessionFingerprint | null = null;
let currentSessionId: string | null = null;

export function startSession(sessionId?: string): void {
  if (currentSessionId) clearJar(currentSessionId);
  currentSessionId = sessionId ?? `laz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  currentFingerprint = pickFingerprint({ preferDesktop: true });
  log.debug({ sessionId: currentSessionId, platform: currentFingerprint.platform }, "lazada session started");
}

export function endSession(): void {
  if (currentSessionId) clearJar(currentSessionId);
  currentSessionId = null;
  currentFingerprint = null;
}

export async function warmUpSession(): Promise<void> {
  if (!currentSessionId || !currentFingerprint) return;
  const headers = fingerprintToHeaders(currentFingerprint);
  const proxy = await proxyPool.pick(currentSessionId);
  await warmUp(currentSessionId, `${LAZADA_BASE}/`, headers, proxy?.url);
}

function ensureSession(): SessionFingerprint {
  if (!currentFingerprint) startSession();
  return currentFingerprint!;
}

function lazadaHeaders(referer = `${LAZADA_BASE}/`): Record<string, string> {
  const fp = ensureSession();
  const headers: Record<string, string> = {
    ...fingerprintToHeaders(fp, referer),
    Accept: "application/json, text/javascript, */*; q=0.01",
    "x-csrf-token": "",
    "x-requested-with": "XMLHttpRequest",
    Origin: LAZADA_BASE,
  };
  if (currentSessionId) {
    const jar = getJar(currentSessionId, "lazada.co.th");
    const cookie = buildCookieHeader(jar);
    if (cookie) headers["Cookie"] = cookie;
  }
  return headers;
}

interface FetchOpts {
  timeoutMs?: number;
  referer?: string;
}

export class LazadaHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly url: string,
  ) {
    super(`Lazada HTTP ${status}: ${url}`);
    this.name = "LazadaHttpError";
  }
}

async function lazadaFetch<T>(path: string, opts: FetchOpts = {}): Promise<T> {
  await waitForThrottle("lazada", 2000);
  await rateLimit("lazada").acquire();

  const url = path.startsWith("http") ? path : `${LAZADA_BASE}${path}`;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  return retry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const proxy = await proxyPool.pick(currentSessionId ?? undefined);
      try {
        const fetchInit: RequestInit & { proxy?: string } = {
          headers: lazadaHeaders(opts.referer),
          signal: ctrl.signal,
        };
        if (proxy) fetchInit.proxy = proxy.url;

        const res = await fetch(url, fetchInit);

        if (currentSessionId) {
          const jar = getJar(currentSessionId, "lazada.co.th");
          ingestSetCookie(jar, res);
        }

        if (res.status === 429) {
          if (proxy) proxyPool.recordResult(proxy.id, false);
          recordResult("lazada", false);
          await sleep(60_000);
          throw new Error("rate-limited");
        }
        if (res.status === 403) {
          if (proxy) proxyPool.recordResult(proxy.id, false);
          recordResult("lazada", false);
          startSession(); // rotate
          const body = await res.text();
          throw new LazadaHttpError(res.status, body.slice(0, 500), url);
        }
        if (!res.ok) {
          if (proxy) proxyPool.recordResult(proxy.id, false);
          recordResult("lazada", false);
          const body = await res.text();
          throw new LazadaHttpError(res.status, body.slice(0, 500), url);
        }
        if (proxy) proxyPool.recordResult(proxy.id, true);
        recordResult("lazada", true);
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    {
      attempts: 3,
      baseDelayMs: 3000,
      maxDelayMs: 60_000,
      shouldRetry: (err) => {
        if (err instanceof LazadaHttpError) return err.status >= 500 || err.status === 429;
        return true;
      },
      onAttempt: (attempt, err) =>
        log.warn({ url, attempt, err: errMsg(err) }, "lazada fetch retry"),
    },
  );
}

/* ===================================================================
 * Endpoints
 * =================================================================== */

interface RawCatalogResponse {
  mods?: {
    listItems?: Array<RawListItem>;
    redMart?: unknown;
  };
}

export interface RawListItem {
  itemId: string;
  nid?: string;
  name: string;
  brandName?: string;
  brandId?: number;
  sellerId: number;
  sellerName?: string;
  shopId?: number;
  price: string;
  priceShow: string;
  originalPrice?: string;
  originalPriceShow?: string;
  discount?: string;
  ratingScore?: string;
  review?: number;
  itemSoldCntShow?: string;
  itemUrl: string;
  image: string;
  thumbs?: Array<{ image: string }>;
  inStock?: boolean;
  isLazMall?: boolean;
  freeShippingDescription?: string;
  location?: string;
  categoryId?: number;
  promotionId?: string;
}

export async function searchByKeyword(
  keyword: string,
  options: { page?: number; sortBy?: string } = {},
): Promise<RawCatalogResponse> {
  const params = new URLSearchParams({
    ajax: "true",
    _keyori: "ss",
    from: "input",
    page: String(options.page ?? 1),
    q: keyword,
  });
  if (options.sortBy) params.set("sort", options.sortBy);
  return lazadaFetch<RawCatalogResponse>(`/catalog/?${params}`);
}

export async function browseCategory(
  categorySlug: string,
  options: { page?: number; sortBy?: string } = {},
): Promise<RawCatalogResponse> {
  const params = new URLSearchParams({
    ajax: "true",
    page: String(options.page ?? 1),
  });
  if (options.sortBy) params.set("sort", options.sortBy);
  return lazadaFetch<RawCatalogResponse>(`/${categorySlug}/?${params}`);
}

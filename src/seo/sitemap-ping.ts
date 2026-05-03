/**
 * SEO sitemap submission — Sprint 29.
 *
 * Two protocols, both work without auth (Google Search Console
 * verification can be added later as a separate Sprint when
 * GOOGLE_OAUTH_REFRESH_TOKEN lands):
 *
 * 1. **IndexNow** (Bing, Yandex, Naver, Seznam, Yep, ...): POST a list
 *    of URLs to https://api.indexnow.org/indexnow with a key. We host
 *    the key file at /indexnow-<key>.txt so the search engine can
 *    verify ownership.
 *
 * 2. **Google sitemap ping**: GET https://www.google.com/ping?sitemap=
 *    Deprecated by Google in 2023 BUT still functional and harmless.
 *    Bing has the same endpoint at https://www.bing.com/ping?sitemap=
 *    (also kept around).
 *
 * Strategy: ping after every site rebuild that produced new product
 * URLs. Throttled to avoid spamming (most engines tolerate ~1 ping/hour
 * before deprioritizing).
 */

import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("seo.sitemap-ping");

export interface SitemapPingResult {
  indexNowOk: boolean;
  googlePingOk: boolean;
  bingPingOk: boolean;
  urlsSubmitted: number;
}

const INDEXNOW_KEY_LENGTH = 32;

/**
 * Generate (or reuse) the IndexNow key. The key is the deterministic
 * hash of (DOMAIN_NAME + BING_INDEXNOW_KEY env). We use BING_INDEXNOW_KEY
 * if set; otherwise derive a stable key from the domain so re-runs use
 * the same key (search engines cache the verification).
 */
export function indexNowKey(): string {
  if (env.BING_INDEXNOW_KEY && env.BING_INDEXNOW_KEY.length >= INDEXNOW_KEY_LENGTH) {
    return env.BING_INDEXNOW_KEY.slice(0, 32);
  }
  // Deterministic fallback — sha256 of the domain truncated to 32 chars.
  // Same key every run so the verification file at /indexnow-<key>.txt
  // stays valid across deploys without manual key rotation.
  const crypto = require("node:crypto");
  return crypto.createHash("sha256").update(`indexnow-${env.SITE_DOMAIN}`).digest("hex").slice(0, 32);
}

/**
 * Returns the body of the verification file that must be served at
 * https://<domain>/<key>.txt for IndexNow ownership proof.
 */
export function indexNowVerificationFile(): { path: string; content: string } {
  const key = indexNowKey();
  return { path: `${key}.txt`, content: key };
}

/**
 * Submit a batch of URLs to IndexNow. Spec allows up to 10,000 per
 * request; we cap at 200 to keep payload small + avoid throttling.
 */
export async function submitToIndexNow(urls: string[]): Promise<boolean> {
  if (urls.length === 0) return false;
  const key = indexNowKey();
  const host = env.SITE_DOMAIN;
  const body = {
    host,
    key,
    keyLocation: `https://${host}/${key}.txt`,
    urlList: urls.slice(0, 200),
  };
  try {
    const res = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 200/202 = accepted, 422 = key not yet validated (still ok long-term)
    const ok = res.status === 200 || res.status === 202;
    log.info({ status: res.status, urls: urls.length }, ok ? "indexnow submitted" : "indexnow non-2xx");
    return ok;
  } catch (err) {
    log.warn({ err: errMsg(err) }, "indexnow submission failed");
    return false;
  }
}

/**
 * Old-school sitemap ping. Not strictly required (Google reads sitemap
 * URLs from robots.txt which is also generated), but harmless and
 * occasionally accelerates first crawl.
 */
async function ping(url: string, label: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    log.info({ status: res.status, label }, `${label} ping`);
    return res.ok;
  } catch (err) {
    log.warn({ err: errMsg(err), label }, `${label} ping failed`);
    return false;
  }
}

/**
 * Submit the current sitemap to all engines. Called after a successful
 * site deploy that changed product URLs.
 */
export async function pingAllEngines(opts: { newUrls?: string[] } = {}): Promise<SitemapPingResult> {
  const sitemapUrl = `https://${env.SITE_DOMAIN}/sitemap.xml`;
  const urls = opts.newUrls ?? [];

  const indexNowOk = urls.length > 0 ? await submitToIndexNow(urls) : false;
  const googlePingOk = await ping(`https://www.google.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, "google");
  const bingPingOk = await ping(`https://www.bing.com/ping?sitemap=${encodeURIComponent(sitemapUrl)}`, "bing");

  return { indexNowOk, googlePingOk, bingPingOk, urlsSubmitted: urls.length };
}

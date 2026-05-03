/**
 * Short.io URL shortener — wraps affiliate links in branded short URLs.
 *
 * Why use it:
 *  - Branded short links convert better in social posts (less suspicious-looking)
 *  - Short.io tracks clicks per short link → real attribution data
 *  - Bypasses some platforms' link expansion that strips affiliate params
 *
 * Used in:
 *  - Pinterest pin URLs
 *  - TikTok/Meta/IG captions
 *  - Web outbound affiliate links
 */

import { env, can } from "./env.ts";
import { child } from "./logger.ts";
import { errMsg, retry } from "./retry.ts";

const log = child("short-link");

const SHORTIO_API = "https://api.short.io/links";

export interface ShortLinkOptions {
  /** Long URL to shorten (Shopee affiliate link). */
  url: string;
  /** Optional custom path (e.g. "iphone17"). */
  path?: string;
  /** Title (Short.io stats use this). */
  title?: string;
  /** Tags for analytics filtering. */
  tags?: string[];
}

export interface ShortLinkResult {
  shortUrl: string;
  id: string;
}

interface InMemoryCache {
  url: string;
  shortUrl: string;
  id: string;
  expiresAt: number;
}

const cache = new Map<string, InMemoryCache>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;

/**
 * Shorten a long URL via Short.io.
 * Returns the long URL unchanged if not configured.
 */
export async function shorten(opts: ShortLinkOptions): Promise<ShortLinkResult> {
  if (!can.shortenLinks()) {
    return { shortUrl: opts.url, id: "" };
  }

  // Cache by URL to avoid duplicate creation
  const cached = cache.get(opts.url);
  if (cached && cached.expiresAt > Date.now()) {
    return { shortUrl: cached.shortUrl, id: cached.id };
  }

  if (env.DEBUG_DRY_RUN) {
    log.debug({ url: opts.url }, "[dry-run] would shorten");
    return { shortUrl: opts.url, id: "dry-run" };
  }

  const apiKey = env.SHORTIO_API_KEY ?? env.BITLY_TOKEN;
  if (!apiKey) {
    return { shortUrl: opts.url, id: "" };
  }

  try {
    const result = await retry(
      async () => {
        const domain = env.SHORTIO_DOMAIN || env.BITLY_DOMAIN;
        const body: Record<string, unknown> = {
          originalURL: opts.url,
          allowDuplicates: false,
        };
        if (domain) body.domain = domain;
        if (opts.path) body.path = opts.path;
        if (opts.title) body.title = opts.title;
        if (opts.tags) body.tags = opts.tags;

        const res = await fetch(SHORTIO_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: apiKey,
            accept: "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`shortio ${res.status}: ${text.slice(0, 200)}`);
        }
        return (await res.json()) as { shortURL: string; idString: string };
      },
      { attempts: 2, baseDelayMs: 500 },
    );
    const out: ShortLinkResult = { shortUrl: result.shortURL, id: result.idString };
    cache.set(opts.url, {
      url: opts.url,
      shortUrl: out.shortUrl,
      id: out.id,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return out;
  } catch (err) {
    log.warn({ err: errMsg(err) }, "shorten failed; falling back to long url");
    return { shortUrl: opts.url, id: "" };
  }
}

/**
 * Specialized helper: shorten a Shopee affiliate link with a content-aware tag.
 */
export async function shortenAffiliate(input: {
  fullUrl: string;
  channel: string;
  contentSlug?: string;
  productExternalId?: string;
}): Promise<string> {
  const tags = [`channel:${input.channel}`];
  if (input.contentSlug) tags.push(`page:${input.contentSlug.slice(0, 40)}`);
  if (input.productExternalId) tags.push(`pid:${input.productExternalId}`);

  const result = await shorten({
    url: input.fullUrl,
    title: `${input.channel} → ${input.contentSlug ?? "deal"}`,
    tags,
  });
  return result.shortUrl;
}

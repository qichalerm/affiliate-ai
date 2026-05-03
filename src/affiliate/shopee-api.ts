/**
 * Shopee Open Affiliate API client — Sprint 25.
 *
 * Calls https://open-api.affiliate.shopee.co.th/graphql to convert
 * a regular product URL into a tracked `shope.ee/xxx` short link.
 * That short link is THE thing Shopee tracks for commission attribution
 * — appending `?af_id=xxx` to a regular product URL does nothing
 * (silently dropped). Confirmed by user: clicks were happening on our
 * /go redirect but Shopee dashboard showed 0 commission.
 *
 * Auth scheme (verified from open-source wrappers + Shopee Brazil docs):
 *   signature = SHA256_HEX( app_id + timestamp + payload + secret )
 *   header:    Authorization: SHA256 Credential=<id>, Signature=<hex>, Timestamp=<unix>
 *
 * Notes:
 *   - Plain SHA256, NOT HMAC.
 *   - `payload` must be the byte-exact JSON we POST. Re-serialize after
 *     signing = invalid signature.
 *   - subIds: max 5, used as utm_content for channel attribution
 *     (FB / IG / TikTok / web / etc.).
 *   - When SHOPEE_API_KEY/SECRET are missing, generateShortLink() returns
 *     null silently — caller should fall back to the unranked /go link.
 */

import crypto from "node:crypto";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry } from "../lib/retry.ts";

const log = child("shopee.api");
const ENDPOINT = "https://open-api.affiliate.shopee.co.th/graphql";

export class ShopeeApiError extends Error {
  constructor(public code: number, message: string, public raw?: unknown) {
    super(message);
    this.name = "ShopeeApiError";
  }
}

export interface ShopeeApiCreds {
  appId: string;
  appSecret: string;
}

function getCreds(): ShopeeApiCreds | null {
  if (!env.SHOPEE_API_KEY || !env.SHOPEE_API_SECRET) return null;
  return { appId: env.SHOPEE_API_KEY, appSecret: env.SHOPEE_API_SECRET };
}

/**
 * Build the Authorization header for a single request.
 * Caller must pass the EXACT JSON string they will POST as `payload`.
 */
export function buildAuthHeader(payload: string, creds: ShopeeApiCreds): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const sigSource = `${creds.appId}${timestamp}${payload}${creds.appSecret}`;
  const signature = crypto.createHash("sha256").update(sigSource).digest("hex");
  return `SHA256 Credential=${creds.appId}, Signature=${signature}, Timestamp=${timestamp}`;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: number } }>;
}

interface GenerateShortLinkResponse {
  generateShortLink: {
    shortLink: string | null;
  } | null;
}

/**
 * Convert a regular Shopee product URL to its tracked shope.ee short link.
 *
 * Returns null if Shopee API credentials aren't configured (caller falls
 * back to non-tracked redirect). Throws ShopeeApiError on API failure
 * so the caller can decide whether to retry / cache the failure.
 *
 * subIds (max 5) get surfaced in conversion reports as utmContent — use
 * them to attribute commission back to the channel/campaign:
 *   subIds: ["web", "homepage", shortId, "", ""]
 */
export async function generateShortLink(opts: {
  originUrl: string;
  subIds?: string[];
}): Promise<string | null> {
  const creds = getCreds();
  if (!creds) {
    log.debug("SHOPEE_API_KEY/SECRET not set — skipping shp.ee gen");
    return null;
  }

  // Strip query string from origin URL — wrappers report query params
  // can break tracking on Shopee's side.
  let origin = opts.originUrl;
  try {
    const u = new URL(origin);
    origin = `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    // not a valid URL; let Shopee API reject it
  }

  // Truncate to max 5 subIds and pad/empty-fill — API expects a [String]
  // (nullable strings, but max-5 list).
  const subIds = (opts.subIds ?? []).slice(0, 5);

  const query = `mutation { generateShortLink(input: { originUrl: ${JSON.stringify(origin)}, subIds: ${JSON.stringify(subIds)} }) { shortLink } }`;
  const body = JSON.stringify({ query });

  const authHeader = buildAuthHeader(body, creds);

  const json = await retry(async () => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body,
    });
    if (!res.ok) {
      throw new ShopeeApiError(res.status, `HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as GraphQLResponse<GenerateShortLinkResponse>;
  }, {
    attempts: 3,
    baseDelayMs: 1000,
    shouldRetry: (err) => {
      // Don't retry on signature/auth errors — they won't fix themselves
      if (err instanceof ShopeeApiError) {
        const msg = err.message.toLowerCase();
        if (msg.includes("signature") || msg.includes("invalid credential")) return false;
      }
      return true;
    },
  });

  if (json.errors?.length) {
    const firstErr = json.errors[0];
    const code = firstErr.extensions?.code ?? 0;
    throw new ShopeeApiError(code, firstErr.message, json.errors);
  }

  const shortLink = json.data?.generateShortLink?.shortLink;
  if (!shortLink) {
    throw new ShopeeApiError(0, "API returned no shortLink", json);
  }

  log.debug({ origin, shortLink, subIds }, "shp.ee generated");
  return shortLink;
}

/**
 * Best-effort wrapper: returns the short link or null on any failure.
 * For use in the hot path (createAffiliateLink) where we'd rather have
 * the affiliate row created with no short URL than fail the whole insert.
 */
export async function tryGenerateShortLink(opts: {
  originUrl: string;
  subIds?: string[];
}): Promise<string | null> {
  try {
    return await generateShortLink(opts);
  } catch (err) {
    log.warn(
      { originUrl: opts.originUrl, err: errMsg(err) },
      "shp.ee generation failed (non-fatal — falling back to direct URL)",
    );
    return null;
  }
}

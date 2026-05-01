/**
 * Twitter/X thread publisher.
 *
 * Why Twitter:
 *   - Free API tier (Basic: $200/mo, Free: tweets only)
 *   - Low AI-content detection vs TikTok/Meta
 *   - Threads index well in Google
 *   - Audience trust higher than TikTok for product info
 *
 * Strategy:
 *   - 1 thread per top product (5-7 tweets)
 *   - Hook → spec → use case → review snippet → cons → verdict → CTA
 *   - Daily cap: 3 threads (avoid spam pattern)
 *   - Affiliate disclosure in tweet 1 + last tweet
 *
 * Setup: TWITTER_API_KEY/SECRET + TWITTER_ACCESS_TOKEN/SECRET
 */

import { db, schema } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry, sleep } from "../lib/retry.ts";
import { complete } from "../lib/claude.ts";
import { rateLimit } from "../scraper/stealth/rate-limiter.ts";
import { getBreaker } from "../lib/circuit-breaker.ts";
import { shortenAffiliate } from "../lib/short-link.ts";
import { buildAffiliateUrl, type Platform } from "../adapters/affiliate-links.ts";
import { bahtFromSatang } from "../lib/format.ts";

const log = child("publisher.twitter");

const TWITTER_API = "https://api.twitter.com/2";

const SYSTEM_PROMPT = `คุณเขียน Twitter thread ภาษาไทยรีวิวสินค้า
ข้อกำหนด:
- 5-7 tweets ทั้งหมด ต่อ thread (รวม intro)
- tweet แรก: hook ใส่ราคา + เหตุผลสั้น (≤ 270 ตัวอักษร)
- tweets ถัดมา: spec, use case, รีวิว 1 อ้าง, ข้อจำกัด, สรุป
- tweet สุดท้าย: CTA + #ad
- ไม่ใช้คำเกินจริง ห้าม emoji ใน tweet 1 (อนุญาตใน tweet อื่น)
- แต่ละ tweet ≤ 270 ตัวอักษร (เผื่อ URL)

JSON: { "tweets": ["...", "..."] }`;

interface ThreadOutput {
  tweets: string[];
}

function parseThreadJson(raw: string): ThreadOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<ThreadOutput>;
  if (!Array.isArray(parsed.tweets)) return { tweets: [] };
  return {
    tweets: parsed.tweets
      .filter((t): t is string => typeof t === "string" && t.length > 0)
      .slice(0, 8)
      .map((t) => t.slice(0, 280)),
  };
}

interface TweetCandidate {
  id: number;
  slug: string;
  platform: Platform;
  name: string;
  brand: string | null;
  current_price: number | null;
  rating: number | null;
  sold_count: number | null;
  external_id: string;
  shop_external_id: string | null;
  category_slug: string | null;
}

export interface PublishOptions {
  limit?: number;
  minScore?: number;
  dedupeDays?: number;
}

interface OAuth1Params {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/**
 * OAuth 1.0a signature (Twitter requires this for v2 user-context endpoints).
 */
async function oauth1Signature(
  method: string,
  url: string,
  params: Record<string, string>,
  cred: OAuth1Params,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: cred.apiKey,
    oauth_token: cred.accessToken,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_nonce: Math.random().toString(36).slice(2),
    oauth_version: "1.0",
  };

  const allParams = { ...params, ...oauthParams };
  const sorted = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");

  const baseString = [method.toUpperCase(), encodeURIComponent(url), encodeURIComponent(sorted)].join("&");
  const signingKey = `${encodeURIComponent(cred.apiSecret)}&${encodeURIComponent(cred.accessSecret)}`;

  // HMAC-SHA1 via Web Crypto API
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(signingKey),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(baseString));
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  oauthParams.oauth_signature = sig;
  return Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
    .join(", ");
}

async function postTweet(
  text: string,
  inReplyToId?: string,
): Promise<{ id: string }> {
  const cred: OAuth1Params = {
    apiKey: env.TWITTER_API_KEY ?? "",
    apiSecret: env.TWITTER_API_SECRET ?? "",
    accessToken: env.TWITTER_ACCESS_TOKEN ?? "",
    accessSecret: env.TWITTER_ACCESS_SECRET ?? "",
  };

  const url = `${TWITTER_API}/tweets`;
  const auth = await oauth1Signature("POST", url, {}, cred);

  const breaker = getBreaker("twitter");
  const result = await breaker.execute(() =>
    retry(
      async () => {
        const body: Record<string, unknown> = { text };
        if (inReplyToId) body.reply = { in_reply_to_tweet_id: inReplyToId };

        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `OAuth ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`twitter ${res.status}: ${txt.slice(0, 200)}`);
        }
        return (await res.json()) as { data: { id: string } };
      },
      { attempts: 2, baseDelayMs: 1000 },
    ),
  );

  return result.data;
}

export async function publishThreadsForTopProducts(
  opts: PublishOptions = {},
): Promise<{ published: number; skipped: number; cost: number }> {
  if (!env.TWITTER_ACCESS_TOKEN || !env.TWITTER_ACCESS_SECRET) {
    log.info("twitter not configured; skip");
    return { published: 0, skipped: 0, cost: 0 };
  }

  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 0.45;
  const dedupeDays = opts.dedupeDays ?? 30;

  const candidates = await db.execute<TweetCandidate>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand,
           p.current_price, p.rating, p.sold_count,
           p.external_id, s.external_id AS shop_external_id,
           c.slug AS category_slug
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.flag_regulated = false
       AND p.rating >= 4.3
       AND p.sold_count >= 200
       AND p.final_score >= ${minScore}
       AND EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status = 'published')
       AND NOT EXISTS (
         SELECT 1 FROM published_posts pp
          WHERE pp.channel = 'twitter'
            AND pp.content_json->>'productId' = p.id::text
            AND pp.published_at > now() - interval '${sql.raw(String(dedupeDays))} days'
       )
     ORDER BY p.final_score DESC
     LIMIT ${limit}
  `);

  if (candidates.length === 0) return { published: 0, skipped: 0, cost: 0 };

  let published = 0;
  let skipped = 0;
  let totalCost = 0;

  for (const c of candidates) {
    try {
      // Generate thread
      const promptLines = [
        `สินค้า: ${c.brand ?? ""} ${c.name}`,
        `ราคา: ${c.current_price ? bahtFromSatang(c.current_price).toLocaleString("th-TH") : "?"} บาท`,
        `คะแนน: ${c.rating}/5`,
        `ยอดขาย: ${c.sold_count}`,
        `หมวด: ${c.category_slug ?? ""}`,
        "",
        "เขียน thread 5-7 tweets ตอบเป็น JSON",
      ];
      const resp = await complete(promptLines.join("\n"), {
        system: SYSTEM_PROMPT,
        cacheSystem: true,
        tier: "fast",
        maxTokens: 1500,
        temperature: 0.6,
      });
      totalCost += resp.costUsd;

      const { tweets } = parseThreadJson(resp.text);
      if (tweets.length < 3) {
        skipped++;
        continue;
      }

      // Build affiliate URL + shorten for last tweet
      const subId = `tw_${c.id}_${Date.now().toString(36).slice(-4)}`;
      const fullUrl = buildAffiliateUrl({
        platform: c.platform,
        externalId: c.external_id,
        shopExternalId: c.shop_external_id,
        subId,
      });
      const shortUrl = fullUrl
        ? await shortenAffiliate({
            fullUrl,
            channel: "twitter",
            contentSlug: c.slug,
            productExternalId: c.external_id,
          })
        : null;

      // Append CTA to last tweet
      if (shortUrl) {
        const reviewUrl = `https://${env.DOMAIN_NAME}/รีวิว/${c.slug}`;
        tweets[tweets.length - 1] = `${tweets[tweets.length - 1]?.slice(0, 200)}\n\nรีวิวเต็ม: ${reviewUrl}\nซื้อ: ${shortUrl} #ad`.slice(0, 280);
      }

      if (env.DEBUG_DRY_RUN) {
        log.info(
          { productId: c.id, tweetCount: tweets.length, first: tweets[0]?.slice(0, 50) },
          "[dry-run] would post thread",
        );
      } else {
        await rateLimit("default").acquire();

        let prevId: string | undefined;
        const tweetIds: string[] = [];
        for (const tweet of tweets) {
          const result = await postTweet(tweet, prevId);
          tweetIds.push(result.id);
          prevId = result.id;
          await sleep(2000); // be polite
        }

        await db.insert(schema.publishedPosts).values({
          channel: "twitter",
          accountIdentifier: env.TWITTER_API_KEY ?? "twitter",
          externalPostId: tweetIds[0] ?? null,
          contentJson: {
            productId: c.id,
            slug: c.slug,
            tweetIds,
            tweets,
          } as Record<string, unknown>,
          publishedAt: new Date(),
          status: "success",
          affiliateDisclosureApplied: true,
          aiLabelApplied: false, // Twitter doesn't yet require AI label
        });
      }

      published++;
      await sleep(5000); // gap between threads
    } catch (err) {
      log.warn({ productId: c.id, err: errMsg(err) }, "thread post failed");
      skipped++;
    }
  }

  log.info({ published, skipped, cost: totalCost.toFixed(4) }, "twitter publish done");
  return { published, skipped, cost: totalCost };
}

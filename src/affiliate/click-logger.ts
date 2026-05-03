/**
 * Click logger (M8 — Sprint 1).
 *
 * Records every click hitting /go/[shortId] with privacy-safe hashed PII.
 * Computes "is_unique" by checking if same (ipHash, linkId) has clicked today.
 *
 * Bot detection: simple UA-based heuristic (cheap). Sophisticated bot
 * filtering belongs in a later sprint (M7 / M9).
 */

import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { bumpVariantClick } from "../brain/bandit.ts";

const log = child("affiliate.click-log");

// Quick + dirty bot heuristic. Real detection would need fingerprinting + CF Bot Management.
const BOT_UA_PATTERNS = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /scrape/i,
  /headless/i,
  /curl/i,
  /wget/i,
  /python-requests/i,
  /go-http-client/i,
  /node-fetch/i,
  /preview/i,        // social link preview crawlers (FB, Slack, etc.)
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /googlebot/i,
  /bingbot/i,
];

function detectBot(userAgent: string): boolean {
  if (!userAgent) return true;  // missing UA = suspicious
  return BOT_UA_PATTERNS.some((p) => p.test(userAgent));
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface LogClickInput {
  affiliateLinkId: number;
  shortId: string;
  ip: string;
  userAgent: string;
  countryCode?: string | null;
  referrer?: string | null;
}

/**
 * Log a click. Best-effort — failures don't block the redirect.
 * Returns the click row id if successful, null on failure.
 */
export async function logClick(input: LogClickInput): Promise<number | null> {
  try {
    const [ipHash, userAgentHash] = await Promise.all([
      sha256Hex(input.ip || "unknown"),
      sha256Hex(input.userAgent || "unknown"),
    ]);

    const isBot = detectBot(input.userAgent);

    // Compute uniqueness: any prior click from same (ipHash, linkId) in last 24h → not unique
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const priorRows = await db
      .select({ id: schema.clicks.id })
      .from(schema.clicks)
      .where(
        and(
          eq(schema.clicks.affiliateLinkId, input.affiliateLinkId),
          eq(schema.clicks.ipHash, ipHash),
          gte(schema.clicks.clickedAt, since),
        ),
      )
      .limit(1);
    const isUnique = priorRows.length === 0;

    const [row] = await db
      .insert(schema.clicks)
      .values({
        affiliateLinkId: input.affiliateLinkId,
        shortId: input.shortId,
        ipHash,
        userAgentHash,
        countryCode: input.countryCode ?? null,
        referrer: input.referrer ?? null,
        isBot,
        isUnique,
      })
      .returning({ id: schema.clicks.id });

    // Brain feedback: bump bandit counters for the variant (if link knows its variant)
    if (!isBot && isUnique) {
      const link = await db.query.affiliateLinks.findFirst({
        where: eq(schema.affiliateLinks.id, input.affiliateLinkId),
        columns: { contentVariantId: true },
      });
      if (link?.contentVariantId) {
        await bumpVariantClick(link.contentVariantId);
      }
    }

    return row?.id ?? null;
  } catch (err) {
    log.warn({ err: errMsg(err), shortId: input.shortId }, "click log failed");
    return null;
  }
}

/**
 * Aggregate click counts per shortId (used by analytics + UI).
 */
export async function getClickStats(shortId: string) {
  const rows = await db.execute<{
    total: number;
    unique_clicks: number;
    bot_clicks: number;
    countries: number;
  }>(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE is_unique = true AND is_bot = false)::int AS unique_clicks,
      COUNT(*) FILTER (WHERE is_bot = true)::int AS bot_clicks,
      COUNT(DISTINCT country_code)::int AS countries
    FROM clicks
    WHERE short_id = ${shortId}
  `);
  return rows[0] ?? { total: 0, unique_clicks: 0, bot_clicks: 0, countries: 0 };
}

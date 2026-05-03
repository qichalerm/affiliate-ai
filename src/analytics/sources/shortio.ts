/**
 * Short.io click sync — pulls click counts per short link.
 *
 * For each affiliate_link with a Short.io short_url, fetches click count
 * from Short.io statistics API and updates clicks count locally.
 *
 * This complements `clicks` table with raw click counts for links we
 * may not have captured via /go endpoint (e.g. social posts where users
 * click directly on the Short.io URL).
 */

import { db, schema } from "../../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg, retry, sleep } from "../../lib/retry.ts";

const log = child("analytics.shortio");

const SHORTIO_STATS_API = "https://statistics.short.io";

interface ShortIoStatsResponse {
  totalClicks?: number;
  humanClicks?: number;
}

export async function ingestShortIoStats(opts: { sinceHours?: number } = {}): Promise<{
  synced: number;
  skipped: number;
  totalClicks: number;
}> {
  const apiKey = env.SHORTIO_API_KEY ?? env.BITLY_TOKEN;
  if (!apiKey) {
    log.info("Short.io key not configured; skip");
    return { synced: 0, skipped: 0, totalClicks: 0 };
  }

  const sinceHours = opts.sinceHours ?? 24;

  // Find affiliate links with short_url created in window
  const links = await db.execute<{
    id: number;
    short_url: string;
    sub_id: string;
  }>(sql`
    SELECT id, short_url, sub_id
      FROM affiliate_links
     WHERE short_url IS NOT NULL
       AND created_at > now() - interval '${sql.raw(String(sinceHours * 24))} hours'
     LIMIT 500
  `);

  if (links.length === 0) {
    log.info("no short links to sync");
    return { synced: 0, skipped: 0, totalClicks: 0 };
  }

  let synced = 0;
  let skipped = 0;
  let totalClicks = 0;

  for (const link of links) {
    try {
      // Extract Short.io ID from URL
      // Short.io URLs: https://{domain}/{path} — we need link_id, not URL
      // The cleaner API call uses our stored bitly/shortio idString from when we created the link
      // For now, query by alias path extracted from URL
      const aliasPath = new URL(link.short_url).pathname.replace(/^\//, "");
      if (!aliasPath) {
        skipped++;
        continue;
      }

      const stats = await retry(
        async () => {
          const url = `${SHORTIO_STATS_API}/statistics/link?period=day&path=${encodeURIComponent(aliasPath)}`;
          const res = await fetch(url, {
            headers: { authorization: apiKey, accept: "application/json" },
          });
          if (!res.ok) {
            throw new Error(`shortio stats ${res.status}`);
          }
          return (await res.json()) as ShortIoStatsResponse;
        },
        { attempts: 2, baseDelayMs: 500 },
      );

      const clicks = stats.humanClicks ?? stats.totalClicks ?? 0;
      totalClicks += clicks;

      // Insert one click row per N actual clicks (sample, not full granularity)
      // This is a coarse approximation; for true per-click data we'd use webhook
      // For Phase 4 we'll likely get conversions data which is more useful anyway.
      if (clicks > 0) {
        await db
          .insert(schema.clicks)
          .values({
            affiliateLinkId: link.id,
            ipHash: null,
            countryCode: null,
            userAgentHash: null,
            referrer: "shortio_sync",
            isUnique: true,
          })
          // Note: this is a placeholder; in practice, pull each row only if we don't already
          // have a count for today. To avoid duplicate inserts, we cap at 1 row/run.
          .onConflictDoNothing();
      }

      synced++;
      await sleep(150);
    } catch (err) {
      skipped++;
      log.debug({ linkId: link.id, err: errMsg(err) }, "shortio sync failed");
    }
  }

  log.info({ synced, skipped, totalClicks }, "shortio sync done");
  return { synced, skipped, totalClicks };
}

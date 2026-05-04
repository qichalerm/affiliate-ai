/**
 * Autonomous publisher — Sprint 30.
 *
 * Closes the last gap in the auto-marketing loop. Pulls products that
 * have ≥1 gate-approved variant on a target channel + haven't been
 * published in the last 24h, then ranks by signal (promo events first,
 * then top final_score), and publishes one per channel per tick.
 *
 * Per V2 vision safeguards:
 *   - Rate limit: max DAILY_POSTS_PER_CHANNEL posts/day per channel
 *   - Random 5-30 min delay before publish (anti-bot detection)
 *   - Dry-run mode preserved when channel's token isn't set —
 *     publisher modules already gate themselves and write
 *     dry_run=true rows to published_posts
 *
 * Channels covered: facebook, instagram, tiktok. shopee_video uses a
 * separate notification flow (Sprint 28) since Shopee has no posting API.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, sleep } from "../lib/retry.ts";
import { publishToFacebook } from "./facebook.ts";
import { publishToInstagram } from "./instagram.ts";
import { publishToTikTok } from "./tiktok.ts";
import type { Platform } from "../quality/platform-rules.ts";

const log = child("publisher.auto");

// Per V2 vision: FB 25/day, IG 25/day, TikTok 5-10/day. Tunable via env.
// shopee_video skipped here — Sprint 28 handles that channel separately
// via the email-digest helper since Shopee has no posting API.
type ActivePlatform = Exclude<Platform, "shopee_video" | "web">;
const DAILY_LIMITS: Record<ActivePlatform, number> = {
  facebook: env.DAILY_POSTS_FACEBOOK ?? 5,
  instagram: env.DAILY_POSTS_INSTAGRAM ?? 5,
  tiktok: env.DAILY_POSTS_TIKTOK ?? 3,
};

const MIN_DELAY_SEC = 30;        // randomize between this and MAX
const MAX_DELAY_SEC = 5 * 60;    // up to 5 min so cron tick still completes

const ACTIVE_CHANNELS: ActivePlatform[] = ["facebook", "instagram", "tiktok"];

export interface AutoPublishResult {
  channelsAttempted: number;
  posted: number;
  skipped: number;
  failed: number;
  byChannel: Record<string, { posted: number; skipped: number; failed: number; reason?: string }>;
}

export async function runAutoPublish(): Promise<AutoPublishResult> {
  const result: AutoPublishResult = {
    channelsAttempted: 0,
    posted: 0,
    skipped: 0,
    failed: 0,
    byChannel: {},
  };

  for (const channel of ACTIVE_CHANNELS) {
    result.channelsAttempted++;
    result.byChannel[channel] = { posted: 0, skipped: 0, failed: 0 };

    // Daily-rate check
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const [{ n: postedToday }] = await db.execute<{ n: number; [k: string]: unknown }>(sql`
      SELECT COUNT(*)::int AS n FROM published_posts
      WHERE channel = ${channel}
        AND status = 'published'
        AND dry_run = false
        AND published_at >= ${todayStart.toISOString()}::timestamptz
    `);
    if ((postedToday ?? 0) >= DAILY_LIMITS[channel]) {
      log.info({ channel, postedToday, cap: DAILY_LIMITS[channel] }, "daily cap reached — skipping channel");
      result.byChannel[channel]!.skipped++;
      result.byChannel[channel]!.reason = `daily cap ${DAILY_LIMITS[channel]} reached`;
      result.skipped++;
      continue;
    }

    // Pick next product to publish on this channel:
    //   - has ≥1 gate-approved active variant on this channel
    //   - hasn't been published on this channel in the last 24h
    //   - prefer products with active promo_events (variants_triggered=true)
    //   - then by final_score desc
    const [pick] = await db.execute<{ productId: number; isPromo: number; [k: string]: unknown }>(sql`
      SELECT p.id AS "productId",
             EXISTS(SELECT 1 FROM promo_events pe
                    WHERE pe.product_id = p.id
                      AND pe.detected_at > NOW() - INTERVAL '6 hours')::int AS "isPromo"
      FROM products p
      WHERE p.is_active = true
        AND p.flag_blacklisted = false
        AND EXISTS (
          SELECT 1 FROM content_variants cv
          WHERE cv.product_id = p.id
            AND cv.channel = ${channel}
            AND cv.gate_approved = true
            AND cv.is_active = true
        )
        AND NOT EXISTS (
          SELECT 1 FROM published_posts pp
          WHERE pp.product_id = p.id
            AND pp.channel = ${channel}
            AND pp.status = 'published'
            AND pp.published_at > NOW() - INTERVAL '24 hours'
        )
      ORDER BY "isPromo" DESC, COALESCE(p.final_score, 0) DESC, p.first_seen_at DESC
      LIMIT 1
    `);

    if (!pick) {
      log.info({ channel }, "no product with publishable variant — skipping");
      result.byChannel[channel]!.skipped++;
      result.byChannel[channel]!.reason = "no candidate";
      result.skipped++;
      continue;
    }

    // Random anti-bot delay
    const delaySec = MIN_DELAY_SEC + Math.floor(Math.random() * (MAX_DELAY_SEC - MIN_DELAY_SEC));
    log.info({ channel, productId: pick.productId, isPromo: !!pick.isPromo, delaySec }, "queued — waiting random delay");
    await sleep(delaySec * 1000);

    // Publish — module picks variant via M3 bandit + handles dry-run gate
    try {
      let res;
      if (channel === "facebook") res = await publishToFacebook({ productId: pick.productId });
      else if (channel === "instagram") res = await publishToInstagram({ productId: pick.productId });
      else res = await publishToTikTok({ productId: pick.productId });

      if (res.status === "published") {
        result.posted++;
        result.byChannel[channel]!.posted++;
        log.info({ channel, productId: pick.productId, platformPostId: res.platformPostId, dryRun: res.dryRun }, "auto-published");
      } else {
        result.failed++;
        result.byChannel[channel]!.failed++;
        log.warn({ channel, productId: pick.productId, status: res.status, error: res.errorMsg }, "auto-publish non-success");
      }
    } catch (err) {
      result.failed++;
      result.byChannel[channel]!.failed++;
      log.error({ channel, productId: pick.productId, err: errMsg(err) }, "auto-publish failed");
    }
  }

  return result;
}

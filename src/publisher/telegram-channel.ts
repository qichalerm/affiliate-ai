/**
 * Telegram channel broadcaster — pushes new deals to public channel.
 * Picks deals based on:
 *  - discount > 25%
 *  - rating >= 4.3 (avoid promoting bad products)
 *  - sold > 100 (proof of demand)
 *  - haven't been broadcast in last 7 days
 */

import { db, schema } from "../lib/db.ts";
import { sql, and, eq, isNull, or, lt } from "drizzle-orm";
import { sendChannel } from "../lib/telegram.ts";
import { formatBaht, compactCount, formatPercent } from "../lib/format.ts";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, sleep } from "../lib/retry.ts";
import { shortenAffiliate } from "../lib/short-link.ts";
import { buildAffiliateUrl, PLATFORM_LABELS, type Platform } from "../adapters/affiliate-links.ts";

const log = child("publisher.telegram");

interface DealCandidate {
  id: number;
  slug: string;
  platform: Platform;
  name: string;
  brand: string | null;
  primaryImage: string | null;
  currentPrice: number | null;
  originalPrice: number | null;
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  externalId: string;
  shopExternalId: string | null;
  shopName: string | null;
  isMall: boolean | null;
}

const DOMAIN = env.DOMAIN_NAME;

export interface BroadcastOptions {
  /** Max deals to broadcast in one run. */
  limit?: number;
  /** Min discount percent (0..1). */
  minDiscount?: number;
  /** Min rating to include. */
  minRating?: number;
  /** Don't repeat broadcasts within N hours. */
  dedupeHours?: number;
}

export async function broadcastDealsToChannel(
  opts: BroadcastOptions = {},
): Promise<{ broadcasted: number; skipped: number }> {
  if (!can.broadcastTelegram()) {
    log.info("telegram channel not configured — skipping broadcast");
    return { broadcasted: 0, skipped: 0 };
  }

  const limit = opts.limit ?? 5;
  const minDiscount = opts.minDiscount ?? 0.25;
  const minRating = opts.minRating ?? 4.3;
  const dedupeHours = opts.dedupeHours ?? 24 * 7;

  const deals = await db.execute<DealCandidate>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand, p.primary_image AS "primaryImage",
           p.current_price AS "currentPrice", p.original_price AS "originalPrice",
           p.discount_percent AS "discountPercent",
           p.rating, p.rating_count AS "ratingCount", p.sold_count AS "soldCount",
           p.external_id AS "externalId",
           s.external_id AS "shopExternalId", s.name AS "shopName",
           COALESCE(s.is_mall, false) AS "isMall"
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.flag_regulated = false
       AND p.discount_percent >= ${minDiscount}
       AND p.rating >= ${minRating}
       -- Apify basic mode rarely populates sold_count; trust rating_count or
       -- discount as alternative signals of demand (matches scrape/scoring).
       AND (p.sold_count >= 100 OR p.rating_count >= 20 OR p.discount_percent >= 0.30)
       AND p.current_price IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM published_posts pp
          WHERE pp.channel = 'telegram'
            AND pp.content_json->>'productId' = p.id::text
            AND pp.published_at > now() - interval '${sql.raw(String(dedupeHours))} hours'
       )
     ORDER BY p.discount_percent DESC, p.sold_count DESC NULLS LAST
     LIMIT ${limit}
  `);

  if (deals.length === 0) {
    log.info("no fresh deals to broadcast");
    return { broadcasted: 0, skipped: 0 };
  }

  let broadcasted = 0;
  let skipped = 0;

  for (const deal of deals) {
    try {
      // Build platform-aware affiliate URL + shorten via Short.io
      const subId = `tg_${deal.id}_${Date.now().toString(36).slice(-4)}`;
      const fullUrl = buildAffiliateUrl({
        platform: deal.platform,
        externalId: deal.externalId,
        shopExternalId: deal.shopExternalId,
        subId,
      });
      let buyShortUrl: string | null = null;
      if (fullUrl) {
        buyShortUrl = await shortenAffiliate({
          fullUrl,
          channel: "telegram",
          contentSlug: deal.slug,
          productExternalId: deal.externalId,
        });
      }
      const message = formatDealMessage(deal, buyShortUrl);
      const photoUrl = deal.primaryImage ?? undefined;

      if (env.DEBUG_DRY_RUN) {
        log.info({ dealId: deal.id, message: message.slice(0, 100) }, "[dry-run]");
      } else if (photoUrl) {
        // Telegram photo with caption (max 1024 chars)
        const { sendChannelPhoto } = await import("../lib/telegram.ts");
        await sendChannelPhoto(photoUrl, message.slice(0, 1024), { parseMode: "Markdown" });
      } else {
        await sendChannel(message, { parseMode: "Markdown" });
      }

      await db.insert(schema.publishedPosts).values({
        channel: "telegram",
        accountIdentifier: env.TELEGRAM_DEAL_CHANNEL_ID ?? "channel",
        contentJson: { productId: deal.id, slug: deal.slug } as Record<string, unknown>,
        publishedAt: new Date(),
        status: "success",
        affiliateDisclosureApplied: true,
      });
      broadcasted++;

      // Polite delay between broadcasts
      await sleep(2000);
    } catch (err) {
      log.warn({ dealId: deal.id, err: errMsg(err) }, "broadcast failed");
      skipped++;
    }
  }

  log.info({ broadcasted, skipped }, "telegram broadcast done");
  return { broadcasted, skipped };
}

function formatDealMessage(d: DealCandidate, buyShortUrl: string | null): string {
  const reviewUrl = `https://${DOMAIN}/รีวิว/${d.slug}`;
  const platformLabel = PLATFORM_LABELS[d.platform] ?? "Shopee";
  const lines: string[] = [];
  lines.push(`🔥 *ลด ${formatPercent(d.discountPercent ?? 0)}* — ${platformLabel}`);
  if (d.brand) lines.push(`*${d.brand}*`);
  lines.push(`${escapeMd(d.name)}`);
  lines.push("");
  if (d.originalPrice && d.currentPrice && d.originalPrice > d.currentPrice) {
    lines.push(`~~${formatBaht(d.originalPrice)}~~ → *${formatBaht(d.currentPrice)}*`);
  } else {
    lines.push(`💰 *${formatBaht(d.currentPrice)}*`);
  }
  if (d.rating != null && d.rating > 0) {
    lines.push(`⭐ ${d.rating.toFixed(1)} (${compactCount(d.ratingCount)} รีวิว)`);
  }
  if (d.soldCount != null && d.soldCount > 0) {
    lines.push(`📦 ขายแล้ว ${compactCount(d.soldCount)} ชิ้น`);
  }
  if (d.isMall && d.platform === "shopee") lines.push("🏬 Shopee Mall");
  if (d.isMall && d.platform === "lazada") lines.push("🏬 LazMall");
  lines.push("");
  if (buyShortUrl) {
    lines.push(`🛒 [ซื้อที่ ${platformLabel}](${buyShortUrl})`);
  }
  lines.push(`📖 [อ่านรีวิวเต็ม](${reviewUrl})`);
  lines.push("");
  lines.push("_ลิงก์มี affiliate — ราคาคุณไม่เปลี่ยน_");
  return lines.join("\n");
}

/** Minimal Telegram Markdown escape — keep most chars, only escape what breaks. */
function escapeMd(s: string): string {
  return s.replace(/([_*\[\]()`~])/g, "\\$1");
}

/**
 * Email newsletter — weekly digest of top deals + new pages.
 *
 * Channel benefits:
 *   - Owned audience (no algorithm risk)
 *   - Highest-trust channel (vs social/SEO)
 *   - Conversion rates 5-10x social
 *   - Stable through platform changes
 *
 * Workflow:
 *   - Subscribers added via web form (Phase 3) or manual import
 *   - Weekly digest: top 5 deals + featured comparison + best-of
 *   - Each link tracked via Short.io
 *   - Unsubscribe link in every email (compliant)
 */

import { db, schema } from "../lib/db.ts";
import { sql, eq, isNull } from "drizzle-orm";
import { env, can } from "../lib/env.ts";
import { sendEmail } from "../lib/email.ts";
import { child } from "../lib/logger.ts";
import { errMsg, sleep } from "../lib/retry.ts";
import { formatBaht, formatPercent } from "../lib/format.ts";
import { buildAffiliateUrl, type Platform } from "../adapters/affiliate-links.ts";
import { shortenAffiliate } from "../lib/short-link.ts";

const log = child("publisher.email");

interface DigestProduct {
  id: number;
  slug: string;
  platform: Platform;
  name: string;
  brand: string | null;
  current_price: number | null;
  original_price: number | null;
  discount_percent: number | null;
  primary_image: string | null;
  external_id: string;
  shop_external_id: string | null;
}

export async function buildWeeklyDigest(): Promise<{
  subject: string;
  html: string;
  text: string;
}> {
  const SITE = `https://${env.DOMAIN_NAME}`;

  // Top 5 deals (by discount × score)
  const deals = await db.execute<DigestProduct>(sql`
    SELECT p.id, p.slug, p.platform::text AS platform,
           p.name, p.brand,
           p.current_price, p.original_price, p.discount_percent,
           p.primary_image,
           p.external_id, s.external_id AS shop_external_id
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.discount_percent >= 0.20
       AND p.rating >= 4.3
       AND p.sold_count >= 200
       AND EXISTS (SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id AND cp.status = 'published')
     ORDER BY (p.discount_percent * COALESCE(p.final_score, 0.5)) DESC NULLS LAST
     LIMIT 5
  `);

  // Featured best-of (newest)
  const bestOfFeatured = await db.execute<{ slug: string; title: string; og_image: string | null }>(sql`
    SELECT slug, title, og_image
      FROM content_pages
     WHERE status = 'published' AND type = 'best_of'
     ORDER BY published_at DESC NULLS LAST
     LIMIT 2
  `);

  // Subject — Thai number formatting
  const weekNum = Math.ceil(Date.now() / (7 * 24 * 60 * 60 * 1000));
  const subject = `🛒 ดีลร้อนสัปดาห์นี้ · ${deals.length} รายการคัดสรร`;

  // Generate per-deal short URLs
  const dealsWithUrls = await Promise.all(
    deals.map(async (d) => {
      const subId = `email_w${weekNum}_${d.id}`;
      const fullUrl = buildAffiliateUrl({
        platform: d.platform,
        externalId: d.external_id,
        shopExternalId: d.shop_external_id,
        subId,
      });
      const shortUrl = fullUrl
        ? await shortenAffiliate({
            fullUrl,
            channel: "email",
            contentSlug: d.slug,
            productExternalId: d.external_id,
          })
        : null;
      return { ...d, shortUrl, reviewUrl: `${SITE}/รีวิว/${d.slug}` };
    }),
  );

  // Build HTML
  const dealsHtml = dealsWithUrls
    .map(
      (d) => `
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-bottom: 16px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
      <tr>
        <td width="100" valign="top" style="padding: 12px;">
          ${
            d.primary_image
              ? `<img src="${d.primary_image}" alt="" width="80" height="80" style="border-radius: 6px; object-fit: cover; display: block;"/>`
              : ""
          }
        </td>
        <td valign="top" style="padding: 12px 12px 12px 0;">
          ${d.brand ? `<p style="margin:0 0 4px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(d.brand)}</p>` : ""}
          <h3 style="margin: 0 0 8px; font-size: 14px; line-height: 1.4;">
            <a href="${d.reviewUrl}" style="color: #0f172a; text-decoration: none;">${escapeHtml(d.name.slice(0, 80))}</a>
          </h3>
          <p style="margin: 0 0 8px;">
            <span style="font-size: 18px; font-weight: bold; color: #ea580c;">${formatBaht(d.current_price)}</span>
            ${
              d.original_price && d.current_price && d.original_price > d.current_price
                ? `<span style="color: #94a3b8; text-decoration: line-through; margin-left: 6px; font-size: 12px;">${formatBaht(d.original_price)}</span>`
                : ""
            }
            ${
              d.discount_percent
                ? `<span style="background: #fee2e2; color: #b91c1c; padding: 2px 6px; border-radius: 3px; font-size: 11px; font-weight: bold; margin-left: 6px;">-${formatPercent(d.discount_percent)}</span>`
                : ""
            }
          </p>
          ${
            d.shortUrl
              ? `<a href="${d.shortUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 8px 14px; border-radius: 4px; text-decoration: none; font-size: 12px; font-weight: 600;">ดูราคาที่ ${d.platform === "shopee" ? "Shopee" : "Lazada"} →</a>`
              : ""
          }
        </td>
      </tr>
    </table>
  `,
    )
    .join("");

  const bestOfHtml = bestOfFeatured.length > 0
    ? `<h2 style="font-size: 18px; margin: 24px 0 12px;">📋 บทความแนะนำ</h2>
       <ul style="padding-left: 20px;">
         ${bestOfFeatured
           .map(
             (b) => `<li style="margin-bottom: 8px;"><a href="${SITE}/ของดี/${b.slug}" style="color: #ea580c;">${escapeHtml(b.title)}</a></li>`,
           )
           .join("")}
       </ul>`
    : "";

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family: -apple-system, sans-serif; background: #f8fafc; padding: 0; margin: 0;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto; padding: 20px;">
    <tr><td>
      <h1 style="font-size: 24px; color: #ea580c; margin: 0 0 8px;">DealFinder</h1>
      <p style="color: #64748b; font-size: 14px; margin: 0 0 24px;">ดีลคัดสรรประจำสัปดาห์ · ${new Date().toLocaleDateString("th-TH")}</p>

      <p style="font-size: 14px; line-height: 1.6;">
        สวัสดีครับ! สัปดาห์นี้เราเก็บ <strong>${dealsWithUrls.length}</strong> ดีลที่ส่วนลด ≥20% + คะแนน ≥4.3 มาให้ดู
      </p>

      <h2 style="font-size: 18px; margin: 24px 0 12px;">🔥 ดีลร้อนสัปดาห์นี้</h2>
      ${dealsHtml}

      ${bestOfHtml}

      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">
      <p style="font-size: 11px; color: #94a3b8; line-height: 1.6;">
        เนื้อหาบางส่วนสรุปโดย AI จากข้อมูลจริง · เราอาจได้รับค่าคอมเมื่อคุณซื้อผ่านลิงก์ในเนื้อหา · ราคาคุณไม่เปลี่ยน<br>
        ไม่ต้องการรับอีเมลนี้? <a href="{{unsubscribe_url}}" style="color: #94a3b8;">ยกเลิกการรับ</a>
      </p>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `DealFinder · ดีลคัดสรรประจำสัปดาห์`,
    "",
    "🔥 ดีลร้อน:",
    ...dealsWithUrls.map(
      (d) =>
        `- ${d.name.slice(0, 60)}\n  ${formatBaht(d.current_price)} (${d.discount_percent ? formatPercent(d.discount_percent) : ""})\n  ${d.reviewUrl}`,
    ),
    "",
    "ไม่ต้องการรับอีเมลนี้? {{unsubscribe_url}}",
  ].join("\n");

  return { subject, html, text };
}

export async function sendWeeklyDigest(): Promise<{
  sent: number;
  skipped: number;
  failed: number;
}> {
  if (!env.RESEND_API_KEY) {
    log.info("RESEND_API_KEY missing; skip newsletter");
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const subscribers = await db.query.emailSubscribers.findMany({
    where: (s, { and, isNull, isNotNull }) =>
      and(isNull(s.unsubscribedAt), isNotNull(s.confirmedAt)),
    columns: { id: true, email: true },
  });

  if (subscribers.length === 0) {
    log.info("no subscribers; skip newsletter");
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const digest = await buildWeeklyDigest();

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const sub of subscribers) {
    try {
      const unsubUrl = `https://${env.DOMAIN_NAME}/unsubscribe/${sub.id}`;
      const html = digest.html.replace("{{unsubscribe_url}}", unsubUrl);
      const text = digest.text.replace("{{unsubscribe_url}}", unsubUrl);

      if (env.DEBUG_DRY_RUN) {
        log.info({ to: sub.email }, "[dry-run] would send digest");
        skipped++;
        continue;
      }

      const result = await sendEmail({
        to: sub.email,
        subject: digest.subject,
        html,
        text,
        tags: [
          { name: "campaign", value: "weekly_digest" },
          { name: "subscriber_id", value: String(sub.id) },
        ],
      });

      if (result.id) {
        await db.insert(schema.emailSends).values({
          subscriberId: sub.id,
          campaign: "weekly_digest",
          subject: digest.subject,
          resendId: result.id,
          sentAt: new Date(),
        });
        await db
          .update(schema.emailSubscribers)
          .set({ lastSentAt: new Date() })
          .where(eq(schema.emailSubscribers.id, sub.id));
        sent++;
      } else {
        failed++;
      }

      // Rate-limit ourselves (Resend rate limit is generous but be polite)
      await sleep(200);
    } catch (err) {
      failed++;
      log.warn({ subId: sub.id, err: errMsg(err) }, "newsletter send failed");
    }
  }

  log.info({ sent, skipped, failed, total: subscribers.length }, "newsletter sent");
  return { sent, skipped, failed };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Shopee Video helper — Sprint 28.
 *
 * Shopee Video doesn't have a public posting API for sellers/affiliates.
 * Workflow:
 *   1. content/video-assembler.ts already produces 1080x1920 vertical
 *      MP4 files for promo products (M4 video gen, dry-run by default).
 *   2. This module finds the latest unpublished videos and emails the
 *      operator a ready-to-upload notification with thumbnails, captions,
 *      and direct file paths so they can manually upload via Shopee's
 *      Video tab on the affiliate dashboard.
 *   3. After operator confirms upload (out-of-band), they mark the
 *      published_posts row as published.
 *
 * Why notification flow vs full automation: Shopee's video upload is
 * gated behind the affiliate creator panel; automating it would require
 * browser automation (Playwright + login session) which is fragile and
 * against ToS. Notification is the honest scope for the channel.
 */

import { and, eq, isNull, gte, sql } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("publisher.shopee-video");

interface PendingVideo {
  variantId: number;
  productId: number;
  productName: string;
  caption: string;
  videoPath: string | null;
  createdAt: string;
  [k: string]: unknown;
}

export interface ShopeeVideoNotifyResult {
  pending: number;
  emailed: boolean;
}

/**
 * Find content_variants for the shopee_video channel that have
 * gate_approved=true, never been published, and were created in the
 * last 24h. Email a digest to OPERATOR_EMAIL with one row per video.
 */
export async function notifyShopeeVideoBacklog(): Promise<ShopeeVideoNotifyResult> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const pending = await db.execute<PendingVideo>(sql`
    SELECT
      cv.id AS "variantId",
      cv.product_id AS "productId",
      p.name AS "productName",
      cv.caption,
      cv.created_at::text AS "createdAt",
      NULL::text AS "videoPath"
    FROM content_variants cv
    JOIN products p ON p.id = cv.product_id
    LEFT JOIN published_posts pp ON pp.content_variant_id = cv.id AND pp.channel = 'shopee_video'
    WHERE cv.channel = 'shopee_video'
      AND cv.gate_approved = true
      AND cv.is_active = true
      AND cv.created_at >= ${since.toISOString()}::timestamptz
      AND pp.id IS NULL
    ORDER BY cv.created_at DESC
    LIMIT 20
  `);

  log.info({ pending: pending.length }, "shopee video backlog scan");

  if (pending.length === 0) {
    return { pending: 0, emailed: false };
  }

  if (!can.alertEmail() || !env.RESEND_API_KEY || !env.OPERATOR_EMAIL) {
    log.info("OPERATOR_EMAIL/RESEND_API_KEY not set — listing only (no email sent)");
    return { pending: pending.length, emailed: false };
  }

  const subject = `📹 Shopee Video: ${pending.length} clips ready to upload`;
  const body = renderEmailBody(pending);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM ?? "alerts@price-th.com",
        to: env.OPERATOR_EMAIL,
        subject,
        text: body,
      }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    log.info({ to: env.OPERATOR_EMAIL, pending: pending.length }, "shopee video digest emailed");
    return { pending: pending.length, emailed: true };
  } catch (err) {
    log.warn({ err: errMsg(err) }, "shopee video email failed");
    return { pending: pending.length, emailed: false };
  }
}

function renderEmailBody(pending: PendingVideo[]): string {
  const lines: string[] = [];
  lines.push(`${pending.length} Shopee Video clips are ready to upload.\n`);
  lines.push(`Open https://affiliate.shopee.co.th/video → Upload → drag the file → paste caption.\n`);
  lines.push("─".repeat(60));
  for (const v of pending) {
    lines.push(`\n#${v.variantId} — Product #${v.productId}`);
    lines.push(`Title: ${v.productName.slice(0, 80)}`);
    lines.push(`Created: ${v.createdAt}`);
    if (v.videoPath) lines.push(`File: ${v.videoPath}`);
    lines.push(`Caption (paste this into Shopee):`);
    lines.push(v.caption);
    lines.push("─".repeat(60));
  }
  lines.push(`\n— Sent by affiliate-ai shopee-video helper (Sprint 28).`);
  return lines.join("\n");
}

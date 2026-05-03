/**
 * TikTok publisher (M5 — Sprint 10).
 *
 * Posts video to TikTok via Content Posting API.
 * Direct Post flow (auto-publish, not draft):
 *   POST /v2/post/publish/inbox/video/init/  with source_info.video_url
 *   Poll status until ready (TikTok processes video async)
 *
 * Requires:
 *   - TIKTOK_ACCESS_TOKEN (OAuth token, refreshable via TIKTOK_REFRESH_TOKEN)
 *   - TIKTOK_OPEN_ID (the user's TikTok identifier)
 *   - Approved Content Posting API access (~30-day review)
 *
 * 1-account strategy per V2 spec — quality > quantity.
 *
 * DRY-RUN: when token missing or DEBUG_DRY_RUN=true, simulates the
 * full flow including a fake publish_id + tiktok.com/@user/video/<id>.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry, sleep } from "../lib/retry.ts";
import { pickVariant } from "./variant-picker.ts";

const log = child("publisher.tiktok");
const TIKTOK_BASE = "https://open.tiktokapis.com";

export interface PublishToTikTokOptions {
  productId: number;
  /** REQUIRED: publicly accessible URL for the MP4 (e.g. R2). */
  videoUrl?: string;
  /** Privacy level (default: PUBLIC). */
  privacyLevel?: "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "SELF_ONLY";
  /** Disable comments. */
  disableComment?: boolean;
  /** Disable duet. */
  disableDuet?: boolean;
  /** Disable stitch. */
  disableStitch?: boolean;
  forceDryRun?: boolean;
}

export interface PublishResult {
  publishedPostId: number;
  platformPostId: string | null;
  platformPostUrl: string | null;
  status: "published" | "failed" | "rate_limited" | "queued";
  variantId: number | null;
  dryRun: boolean;
  errorMsg?: string;
}

interface TikTokInitResponse {
  data?: { publish_id: string };
  error?: { code: string; message: string; log_id: string };
}

interface TikTokStatusResponse {
  data?: {
    status: "PROCESSING_UPLOAD" | "FAILED" | "PUBLISH_COMPLETE";
    publish_id: string;
    publicly_available_post_id?: string[];
    fail_reason?: string;
  };
  error?: { code: string; message: string };
}

function isDryRunMode(opts: PublishToTikTokOptions): boolean {
  if (opts.forceDryRun) return true;
  if (env.DEBUG_DRY_RUN) return true;
  if (!env.TIKTOK_ACCESS_TOKEN || !env.TIKTOK_OPEN_ID) return true;
  return false;
}

export async function publishToTikTok(
  opts: PublishToTikTokOptions,
): Promise<PublishResult> {
  // 1. Pick variant
  const variant = await pickVariant(opts.productId, "tiktok");
  if (!variant) {
    log.warn({ productId: opts.productId }, "no approved tiktok variant");
    const [row] = await db
      .insert(schema.publishedPosts)
      .values({
        productId: opts.productId,
        channel: "tiktok",
        status: "failed",
        failureReason: "no approved variant exists",
        failedAt: new Date(),
        dryRun: isDryRunMode(opts),
      })
      .returning({ id: schema.publishedPosts.id });
    return {
      publishedPostId: row!.id,
      platformPostId: null,
      platformPostUrl: null,
      status: "failed",
      variantId: null,
      dryRun: isDryRunMode(opts),
      errorMsg: "no approved variant",
    };
  }

  const dryRun = isDryRunMode(opts);

  // TikTok requires video — fail fast in live mode
  if (!dryRun && !opts.videoUrl) {
    log.warn({ productId: opts.productId }, "TikTok requires videoUrl");
    const [row] = await db
      .insert(schema.publishedPosts)
      .values({
        contentVariantId: variant.id,
        productId: opts.productId,
        channel: "tiktok",
        status: "failed",
        captionPosted: variant.caption,
        failureReason: "TikTok requires videoUrl",
        failedAt: new Date(),
        dryRun: false,
      })
      .returning({ id: schema.publishedPosts.id });
    return {
      publishedPostId: row!.id,
      platformPostId: null,
      platformPostUrl: null,
      status: "failed",
      variantId: variant.id,
      dryRun: false,
      errorMsg: "TikTok requires videoUrl",
    };
  }

  // 2. Insert "publishing" row
  const [postRow] = await db
    .insert(schema.publishedPosts)
    .values({
      contentVariantId: variant.id,
      productId: opts.productId,
      channel: "tiktok",
      status: "publishing",
      captionPosted: variant.caption,
      videoUrl: opts.videoUrl ?? null,
      dryRun,
    })
    .returning({ id: schema.publishedPosts.id });
  const publishedPostId = postRow!.id;

  // 3. Call TikTok API (or simulate)
  let platformPostId: string | null = null;
  let platformPostUrl: string | null = null;
  let status: PublishResult["status"] = "published";
  let errorMsg: string | undefined;

  if (dryRun) {
    platformPostId = `fake_tt_${crypto.randomUUID().slice(0, 18)}`;
    platformPostUrl = `https://www.tiktok.com/@priceth/video/${platformPostId}`;
    log.info(
      {
        publishedPostId,
        productId: opts.productId,
        variantId: variant.id,
        captionLen: variant.caption.length,
        privacy: opts.privacyLevel ?? "PUBLIC_TO_EVERYONE",
        videoUrl: opts.videoUrl,
      },
      "[DRY-RUN] would publish to TikTok",
    );
  } else {
    try {
      const result = await callTikTokApi(variant.caption, opts);
      platformPostId = result.platformPostId;
      platformPostUrl = result.platformPostUrl;
    } catch (err) {
      const msg = errMsg(err);
      status = msg.includes("rate") || msg.includes("throttl") ? "rate_limited" : "failed";
      errorMsg = msg;
      log.error({ publishedPostId, err: msg }, "tiktok publish failed");
    }
  }

  // 4. Update row
  await db
    .update(schema.publishedPosts)
    .set({
      status,
      platformPostId,
      platformPostUrl,
      publishedAt: status === "published" ? new Date() : null,
      failedAt: status === "failed" ? new Date() : null,
      failureReason: errorMsg ?? null,
    })
    .where(eq(schema.publishedPosts.id, publishedPostId));

  return {
    publishedPostId,
    platformPostId,
    platformPostUrl,
    status,
    variantId: variant.id,
    dryRun,
    errorMsg,
  };
}

/**
 * TikTok Content Posting API: 2-step (init + poll).
 * https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */
async function callTikTokApi(
  caption: string,
  opts: PublishToTikTokOptions,
): Promise<{ platformPostId: string; platformPostUrl: string | null }> {
  const token = env.TIKTOK_ACCESS_TOKEN!;

  // Step 1: init publish
  const initEndpoint = `${TIKTOK_BASE}/v2/post/publish/video/init/`;
  const initBody = {
    post_info: {
      title: caption,
      privacy_level: opts.privacyLevel ?? "PUBLIC_TO_EVERYONE",
      disable_comment: opts.disableComment ?? false,
      disable_duet: opts.disableDuet ?? false,
      disable_stitch: opts.disableStitch ?? false,
    },
    source_info: {
      source: "PULL_FROM_URL",
      video_url: opts.videoUrl,
    },
  };

  const initResp = await retry(
    async () => {
      const res = await fetch(initEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(initBody),
      });
      const data = (await res.json()) as TikTokInitResponse;
      if (data.error && data.error.code !== "ok") {
        throw new Error(`TikTok init error ${data.error.code}: ${data.error.message}`);
      }
      if (!data.data?.publish_id) throw new Error("TikTok init returned no publish_id");
      return data.data;
    },
    { attempts: 2, baseDelayMs: 1000 },
  );

  const publishId = initResp.publish_id;

  // Step 2: poll status until PUBLISH_COMPLETE or FAILED
  const statusEndpoint = `${TIKTOK_BASE}/v2/post/publish/status/fetch/`;
  let attempts = 0;
  while (attempts < 30) {  // ~90s max
    attempts++;
    await sleep(3000);

    const res = await fetch(statusEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const data = (await res.json()) as TikTokStatusResponse;

    if (data.data?.status === "PUBLISH_COMPLETE") {
      const platformPostId = data.data.publicly_available_post_id?.[0] ?? publishId;
      // We don't know the user's @username from the API response — store generic URL
      const platformPostUrl = `https://www.tiktok.com/video/${platformPostId}`;
      return { platformPostId, platformPostUrl };
    }
    if (data.data?.status === "FAILED") {
      throw new Error(`TikTok publish FAILED: ${data.data.fail_reason ?? "unknown"}`);
    }
    // Still PROCESSING_UPLOAD — keep polling
  }

  throw new Error(`TikTok publish status check timed out after 90s (publish_id=${publishId})`);
}

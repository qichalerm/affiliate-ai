/**
 * Instagram Business publisher (M5 — Sprint 6).
 *
 * Posts to IG Business via Meta Graph API v21.0.
 * IG requires media (image or video) — cannot text-only post.
 *
 * 2-step flow per Meta docs:
 *   1. POST /{ig-user-id}/media          — create container
 *   2. POST /{ig-user-id}/media_publish  — publish container
 *
 * Uses same long-lived Page Access Token as FB (META_PAGE_ACCESS_TOKEN).
 * IG account must be Business + linked to the FB Page.
 *
 * Sprint 6 scope: image posts only (Reels add ~2x complexity, defer to Sprint 7
 * when video gen lands).
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry, sleep } from "../lib/retry.ts";
import { pickVariant } from "./variant-picker.ts";

const log = child("publisher.instagram");
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export interface PublishToInstagramOptions {
  productId: number;
  /** REQUIRED for IG — image URL (publicly accessible). */
  imageUrl?: string;
  /** Alternative: video URL for Reels (Sprint 7). */
  videoUrl?: string;
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

interface IgContainerResponse {
  id?: string;
  error?: { message: string; code: number };
}

interface IgPublishResponse {
  id?: string;
  error?: { message: string; code: number };
}

function isDryRunMode(opts: PublishToInstagramOptions): boolean {
  if (opts.forceDryRun) return true;
  if (env.DEBUG_DRY_RUN) return true;
  if (!env.META_PAGE_ACCESS_TOKEN || !env.META_INSTAGRAM_BUSINESS_ID) return true;
  return false;
}

export async function publishToInstagram(
  opts: PublishToInstagramOptions,
): Promise<PublishResult> {
  // 1. Pick variant
  const variant = await pickVariant(opts.productId, "instagram");
  if (!variant) {
    log.warn({ productId: opts.productId }, "no approved instagram variant");
    const [row] = await db
      .insert(schema.publishedPosts)
      .values({
        productId: opts.productId,
        channel: "instagram",
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

  // IG requires media — fail fast in live mode if missing
  if (!dryRun && !opts.imageUrl && !opts.videoUrl) {
    log.warn({ productId: opts.productId }, "IG requires image or video — none provided");
    const [row] = await db
      .insert(schema.publishedPosts)
      .values({
        contentVariantId: variant.id,
        productId: opts.productId,
        channel: "instagram",
        status: "failed",
        captionPosted: variant.caption,
        failureReason: "IG requires media (image or video)",
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
      errorMsg: "IG requires media",
    };
  }

  // 2. Insert "publishing" row
  const [postRow] = await db
    .insert(schema.publishedPosts)
    .values({
      contentVariantId: variant.id,
      productId: opts.productId,
      channel: "instagram",
      status: "publishing",
      captionPosted: variant.caption,
      imageUrl: opts.imageUrl ?? null,
      videoUrl: opts.videoUrl ?? null,
      dryRun,
    })
    .returning({ id: schema.publishedPosts.id });
  const publishedPostId = postRow!.id;

  // 3. Call Meta API (or simulate)
  let platformPostId: string | null = null;
  let platformPostUrl: string | null = null;
  let status: PublishResult["status"] = "published";
  let errorMsg: string | undefined;

  if (dryRun) {
    platformPostId = `fake_ig_${crypto.randomUUID()}`;
    platformPostUrl = `https://www.instagram.com/p/${platformPostId}`;
    log.info(
      {
        publishedPostId,
        productId: opts.productId,
        variantId: variant.id,
        captionLen: variant.caption.length,
        hasImage: Boolean(opts.imageUrl),
        hasVideo: Boolean(opts.videoUrl),
      },
      "[DRY-RUN] would publish to Instagram",
    );
  } else {
    try {
      const result = await callIgApi(variant.caption, opts);
      platformPostId = result.platformPostId;
      platformPostUrl = result.platformPostUrl;
    } catch (err) {
      const msg = errMsg(err);
      status = msg.includes("rate") || msg.includes("throttl") ? "rate_limited" : "failed";
      errorMsg = msg;
      log.error({ publishedPostId, err: msg }, "instagram publish failed");
    }
  }

  // 4. Update row with final status
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
 * 2-step IG publish: create container, then publish it.
 * Container creation can take a few seconds; we poll briefly.
 */
async function callIgApi(
  caption: string,
  opts: PublishToInstagramOptions,
): Promise<{ platformPostId: string; platformPostUrl: string | null }> {
  const igUserId = env.META_INSTAGRAM_BUSINESS_ID!;
  const token = env.META_PAGE_ACCESS_TOKEN!;

  // Step 1: create media container
  const containerEndpoint = `${GRAPH_BASE}/${igUserId}/media`;
  const containerBody: Record<string, string> = { caption, access_token: token };
  if (opts.videoUrl) {
    containerBody.media_type = "REELS";
    containerBody.video_url = opts.videoUrl;
  } else if (opts.imageUrl) {
    containerBody.image_url = opts.imageUrl;
  }

  const container = await retry(
    async () => {
      const res = await fetch(containerEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(containerBody).toString(),
      });
      const data = (await res.json()) as IgContainerResponse;
      if (data.error) {
        throw new Error(`IG container create error ${data.error.code}: ${data.error.message}`);
      }
      if (!data.id) throw new Error("IG container create returned no id");
      return data;
    },
    { attempts: 2, baseDelayMs: 1000 },
  );

  const containerId = container.id!;

  // Step 2: wait briefly for container to be ready (esp. for video — async processing)
  if (opts.videoUrl) {
    await sleep(5000);
  } else {
    await sleep(1000);
  }

  // Step 3: publish container
  const publishEndpoint = `${GRAPH_BASE}/${igUserId}/media_publish`;
  const publishResp = await retry(
    async () => {
      const res = await fetch(publishEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          creation_id: containerId,
          access_token: token,
        }).toString(),
      });
      const data = (await res.json()) as IgPublishResponse;
      if (data.error) {
        throw new Error(`IG publish error ${data.error.code}: ${data.error.message}`);
      }
      if (!data.id) throw new Error("IG publish returned no id");
      return data;
    },
    { attempts: 2, baseDelayMs: 2000 },
  );

  const platformPostId = publishResp.id!;
  const platformPostUrl = `https://www.instagram.com/p/${platformPostId}`;
  return { platformPostId, platformPostUrl };
}

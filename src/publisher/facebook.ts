/**
 * Facebook Page publisher (M5 — Sprint 5).
 *
 * Posts to Facebook Page via Meta Graph API v21.0.
 *
 *   Text-only:    POST /{page-id}/feed       { message }
 *   With image:   POST /{page-id}/photos     { url, caption, published }
 *   With video:   POST /{page-id}/videos     { file_url, description }
 *
 * Uses long-lived Page Access Token (META_PAGE_ACCESS_TOKEN).
 * Token lifecycle: 60 days → must refresh before expiry. M0 health
 * check should monitor token expiry (Sprint 7+).
 *
 * DRY-RUN MODE: when META_PAGE_ACCESS_TOKEN is missing OR DEBUG_DRY_RUN=true,
 * skips the actual API call and returns a synthetic fake postId. Lets the
 * full pipeline (variant pick → publish → log) be tested end-to-end before
 * Meta credentials arrive.
 */

import { eq } from "drizzle-orm";
import { db, schema } from "../lib/db.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry } from "../lib/retry.ts";
import { pickVariant } from "./variant-picker.ts";

const log = child("publisher.facebook");
const GRAPH_BASE = "https://graph.facebook.com/v21.0";

export interface PublishToFacebookOptions {
  productId: number;
  imageUrl?: string;     // optional: post with image
  videoUrl?: string;     // optional: post with video (MP4)
  scheduledAt?: Date;    // future: schedule for later
  /** Override env DEBUG_DRY_RUN — useful for tests. */
  forceDryRun?: boolean;
}

export interface PublishResult {
  publishedPostId: number;       // our DB row id
  platformPostId: string | null; // FB's post id (or fake_<uuid> in dry-run)
  platformPostUrl: string | null;
  status: "published" | "failed" | "rate_limited" | "queued";
  variantId: number | null;
  dryRun: boolean;
  errorMsg?: string;
}

interface FbApiPostResponse {
  id?: string;
  post_id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
    fbtrace_id?: string;
  };
}

function isDryRunMode(opts: PublishToFacebookOptions): boolean {
  if (opts.forceDryRun) return true;
  if (env.DEBUG_DRY_RUN) return true;
  if (!env.META_PAGE_ACCESS_TOKEN || !env.META_PAGE_ID) return true;
  return false;
}

/**
 * Pick a variant + publish it to FB. Logs to published_posts regardless of mode.
 */
export async function publishToFacebook(opts: PublishToFacebookOptions): Promise<PublishResult> {
  // 1. Pick variant
  const variant = await pickVariant(opts.productId, "facebook");
  if (!variant) {
    log.warn({ productId: opts.productId }, "no approved facebook variant — generate first");
    // Insert failed row so the operator can see we tried
    const [row] = await db
      .insert(schema.publishedPosts)
      .values({
        productId: opts.productId,
        channel: "facebook",
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

  // 2. Insert "publishing" row
  const [postRow] = await db
    .insert(schema.publishedPosts)
    .values({
      contentVariantId: variant.id,
      productId: opts.productId,
      channel: "facebook",
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
    platformPostId = `fake_${crypto.randomUUID()}`;
    platformPostUrl = `https://www.facebook.com/${env.META_PAGE_ID ?? "DRYRUN_PAGE"}/posts/${platformPostId}`;
    log.info(
      {
        publishedPostId,
        productId: opts.productId,
        variantId: variant.id,
        captionLen: variant.caption.length,
        hasImage: Boolean(opts.imageUrl),
        hasVideo: Boolean(opts.videoUrl),
      },
      "[DRY-RUN] would publish to Facebook",
    );
  } else {
    try {
      const result = await callMetaApi(variant.caption, opts);
      platformPostId = result.platformPostId;
      platformPostUrl = result.platformPostUrl;
    } catch (err) {
      const msg = errMsg(err);
      status = msg.includes("rate") || msg.includes("throttl") ? "rate_limited" : "failed";
      errorMsg = msg;
      log.error({ publishedPostId, err: msg }, "facebook publish failed");
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
 * Real Meta Graph API call. Only invoked when token is present + not dry-run.
 */
async function callMetaApi(
  caption: string,
  opts: PublishToFacebookOptions,
): Promise<{ platformPostId: string; platformPostUrl: string | null }> {
  const pageId = env.META_PAGE_ID!;
  const token = env.META_PAGE_ACCESS_TOKEN!;

  let endpoint: string;
  let body: Record<string, string>;

  if (opts.videoUrl) {
    endpoint = `${GRAPH_BASE}/${pageId}/videos`;
    body = {
      file_url: opts.videoUrl,
      description: caption,
      access_token: token,
    };
  } else if (opts.imageUrl) {
    endpoint = `${GRAPH_BASE}/${pageId}/photos`;
    body = {
      url: opts.imageUrl,
      caption: caption,
      published: "true",
      access_token: token,
    };
  } else {
    endpoint = `${GRAPH_BASE}/${pageId}/feed`;
    body = {
      message: caption,
      access_token: token,
    };
  }

  const json = await retry(
    async () => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(body).toString(),
      });
      const data = (await res.json()) as FbApiPostResponse;
      if (data.error) {
        throw new Error(`Meta API error ${data.error.code}: ${data.error.message}`);
      }
      return data;
    },
    { attempts: 2, baseDelayMs: 1000 },
  );

  const platformPostId = json.post_id ?? json.id ?? "";
  const platformPostUrl = platformPostId
    ? `https://www.facebook.com/${pageId}/posts/${platformPostId.split("_")[1] ?? platformPostId}`
    : null;
  return { platformPostId, platformPostUrl };
}

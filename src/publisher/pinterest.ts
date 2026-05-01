/**
 * Pinterest auto-pin publisher.
 *
 * Pinterest is uniquely valuable because:
 *  - Pins live for years (vs TikTok 48h)
 *  - Lower bot/AI detection sensitivity than Meta/TikTok
 *  - Free API access (no dev approval delay)
 *  - Vertical 2:3 image format = same source we use elsewhere
 *
 * Strategy:
 *  - For each high-scoring product not pinned in 30 days:
 *    - Generate 3 pin variants with different titles + descriptions
 *    - Pin to category-matched board
 *    - Each pin links to /รีวิว/{slug} (so Shopee click = our affiliate)
 *  - Rate limit: max 30 pins/run (Pinterest API limit ~100/hr)
 *
 * Disabled by feature flag (FEATURE_PINTEREST_AUTO_POST). Schema + queries ready;
 * just enable when token + board IDs configured.
 */

import { db, schema } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry, sleep } from "../lib/retry.ts";
import { rateLimit } from "../scraper/stealth/rate-limiter.ts";
import { shortenAffiliate } from "../lib/short-link.ts";
import { complete } from "../lib/claude.ts";

const log = child("publisher.pinterest");

const PINTEREST_API = "https://api.pinterest.com/v5";

interface PinCandidate {
  product_id: number;
  slug: string;
  name: string;
  brand: string | null;
  primary_image: string | null;
  current_price: number | null;
  rating: number | null;
  sold_count: number | null;
  category_slug: string | null;
  external_id: string;
  shop_external_id: string | null;
  final_score: number | null;
}

interface PinTitleOutput {
  variants: Array<{ title: string; description: string }>;
}

const TITLE_SYSTEM = `คุณเขียน Pinterest pin titles + descriptions ภาษาไทย
ข้อกำหนด:
- title: 30–55 ตัวอักษร, hook ดึงดูด, ใส่ตัวเลข/คำเฉพาะ
- description: 100–200 ตัวอักษร, มี CTA implicit, ใส่ keyword
- ห้ามคำเกินจริง: "ดีที่สุด", "อันดับ 1"
- ห้าม emoji ในบรรทัด title (ใน description ใส่ได้บ้าง)

ตอบ JSON: { "variants": [{ "title": "...", "description": "..." }, ... ×3] }`;

function parsePinTitleJson(raw: string): PinTitleOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<PinTitleOutput>;
  if (!Array.isArray(parsed.variants)) return { variants: [] };
  return {
    variants: parsed.variants
      .filter((v): v is { title: string; description: string } => !!v && typeof v.title === "string")
      .slice(0, 3)
      .map((v) => ({
        title: v.title.slice(0, 100),
        description: (v.description ?? "").slice(0, 500),
      })),
  };
}

interface BoardMap {
  default: string;
  byCategorySlug: Record<string, string>;
}

function getBoardMap(): BoardMap {
  // Format: "default=BOARD_ID,electronics=BOARD_ID,beauty=BOARD_ID"
  // For simplicity, accept comma-separated list (first = default)
  const raw = env.PINTEREST_BOARD_IDS ?? "";
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) return { default: "", byCategorySlug: {} };

  const byCategory: Record<string, string> = {};
  let defaultId = ids[0]!;
  for (const entry of ids) {
    if (entry.includes("=")) {
      const [key, val] = entry.split("=");
      if (key === "default") defaultId = val ?? defaultId;
      else if (key && val) byCategory[key] = val;
    }
  }
  return { default: defaultId, byCategorySlug: byCategory };
}

export interface PinPublishOptions {
  /** Max pins to publish per run. */
  limit?: number;
  /** Min final_score to consider. */
  minScore?: number;
  /** Don't re-pin within N days. */
  dedupeDays?: number;
}

export async function publishPinsForTopProducts(
  opts: PinPublishOptions = {},
): Promise<{ published: number; skipped: number; cost: number }> {
  if (!can.postPinterest()) {
    log.info("pinterest disabled (no token or feature flag off)");
    return { published: 0, skipped: 0, cost: 0 };
  }

  const limit = opts.limit ?? 20;
  const minScore = opts.minScore ?? 0.4;
  const dedupeDays = opts.dedupeDays ?? 30;

  const boardMap = getBoardMap();
  if (!boardMap.default) {
    log.warn("PINTEREST_BOARD_IDS not configured");
    return { published: 0, skipped: 0, cost: 0 };
  }

  const candidates = await db.execute<PinCandidate>(sql`
    SELECT p.id AS product_id, p.slug, p.name, p.brand, p.primary_image,
           p.current_price, p.rating, p.sold_count,
           p.external_id, s.external_id AS shop_external_id,
           c.slug AS category_slug, p.final_score
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
      LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.flag_regulated = false
       AND p.rating >= 4.2
       AND p.sold_count >= 100
       AND p.primary_image IS NOT NULL
       AND p.final_score >= ${minScore}
       AND NOT EXISTS (
         SELECT 1 FROM published_posts pp
          WHERE pp.channel = 'pinterest'
            AND pp.content_json->>'productId' = p.id::text
            AND pp.published_at > now() - interval '${sql.raw(String(dedupeDays))} days'
       )
     ORDER BY p.final_score DESC
     LIMIT ${limit}
  `);

  if (candidates.length === 0) {
    log.info("no pin candidates");
    return { published: 0, skipped: 0, cost: 0 };
  }

  let published = 0;
  let skipped = 0;
  let totalCost = 0;

  for (const c of candidates) {
    try {
      // Generate pin variants
      const titleResp = await complete(
        `สินค้า: ${c.brand ?? ""} ${c.name}\nราคา: ${c.current_price ? Math.round(c.current_price / 100) : "?"} บาท\nคะแนน: ${c.rating ?? "?"}/5\nหมวด: ${c.category_slug ?? "general"}\n\nเขียน 3 variants ของ pin title + description`,
        {
          system: TITLE_SYSTEM,
          tier: "fast",
          maxTokens: 600,
          temperature: 0.7,
        },
      );
      totalCost += titleResp.costUsd;

      let variants: PinTitleOutput["variants"];
      try {
        variants = parsePinTitleJson(titleResp.text).variants;
      } catch {
        skipped++;
        continue;
      }
      if (variants.length === 0) {
        skipped++;
        continue;
      }

      const variant = variants[0]!; // pick first; future: rotate

      const targetUrl = `https://${env.DOMAIN_NAME}/รีวิว/${c.slug}`;

      const boardId = boardMap.byCategorySlug[c.category_slug ?? ""] ?? boardMap.default;

      await rateLimit("pinterest").acquire();

      const result = await retry(
        async () => {
          const res = await fetch(`${PINTEREST_API}/pins`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${env.PINTEREST_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              board_id: boardId,
              media_source: { source_type: "image_url", url: c.primary_image },
              title: variant.title,
              description: variant.description,
              link: targetUrl,
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            throw new Error(`pinterest ${res.status}: ${text.slice(0, 200)}`);
          }
          return (await res.json()) as { id: string };
        },
        { attempts: 2, baseDelayMs: 1000 },
      );

      await db.insert(schema.publishedPosts).values({
        channel: "pinterest",
        accountIdentifier: boardId,
        externalPostId: result.id,
        contentJson: {
          productId: c.product_id,
          slug: c.slug,
          title: variant.title,
          description: variant.description,
        } as Record<string, unknown>,
        publishedAt: new Date(),
        status: "success",
        affiliateDisclosureApplied: true,
        aiLabelApplied: false, // Pinterest does not yet require AI label as of mid-2026
      });

      published++;
      await sleep(2500); // polite pacing
    } catch (err) {
      log.warn({ productId: c.product_id, err: errMsg(err) }, "pin failed");
      skipped++;
    }
  }

  log.info({ published, skipped, cost: totalCost.toFixed(4) }, "pinterest publish done");
  return { published, skipped, cost: totalCost };
}

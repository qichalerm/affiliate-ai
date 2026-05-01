/**
 * Scheduled jobs — composable units that the cron runner invokes.
 * Each job is a pure async function; failures are logged but don't crash the scheduler.
 */

import { runShopeeScrape } from "../scraper/shopee/runner.ts";
import { generateReviewPage } from "../content/generator.ts";
import { broadcastDealsToChannel } from "../publisher/telegram-channel.ts";
import { runHealthChecks } from "../monitoring/health.ts";
import { sendDailyReport } from "../monitoring/daily-report.ts";
import { runScoring } from "../intelligence/score-runner.ts";
import { db, schema } from "../lib/db.ts";
import { sql, eq, isNull, lt, and } from "drizzle-orm";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { env } from "../lib/env.ts";
import { createAlert } from "../monitoring/alerts.ts";

const log = child("jobs");

/* ===================================================================
 * 1. Trending keywords for the configured niche
 * =================================================================== */

const NICHE_KEYWORDS: Record<string, string[]> = {
  it_gadget: [
    "หูฟังบลูทูธ",
    "เมาส์ gaming",
    "คีย์บอร์ด mechanical",
    "Powerbank",
    "เคสโทรศัพท์",
    "สายชาร์จ Type C",
    "ลำโพงบลูทูธ",
    "ขาตั้งโน๊ตบุ๊ค",
    "ที่ชาร์จเร็ว",
    "หน้าจอ monitor",
    "smart watch",
    "tws",
  ],
  beauty: [
    "เซรั่ม",
    "ครีมกันแดด",
    "ลิปสติก",
    "มาส์กหน้า",
    "โฟมล้างหน้า",
    "บำรุงผิว",
    "วิตามินผิว",
    "ครีมบำรุง",
  ],
  home: [
    "หม้อทอดไร้น้ำมัน",
    "เครื่องชงกาแฟ",
    "พัดลมไอเย็น",
    "เครื่องดูดฝุ่น",
    "หม้อหุงข้าว",
    "ที่นอน",
    "ผ้าปูที่นอน",
    "เครื่องฟอกอากาศ",
  ],
  sports: [
    "ดัมเบล",
    "เสื่อโยคะ",
    "รองเท้าวิ่ง",
    "ขวดน้ำสปอร์ต",
    "ลู่วิ่ง",
    "พ็อกเก็ตวิ่ง",
  ],
  mom_baby: [
    "ผ้าอ้อม",
    "นมผง",
    "ขวดนม",
    "รถเข็นเด็ก",
    "คาร์ซีท",
    "ของเล่นเสริมพัฒนาการ",
  ],
};

export async function jobScrapeTrending(): Promise<void> {
  const keywords = NICHE_KEYWORDS[env.PRIMARY_NICHE] ?? NICHE_KEYWORDS.it_gadget;
  // Pick 3 random keywords each run to spread coverage
  const picks = keywords
    .map((k) => [Math.random(), k] as const)
    .sort(([a], [b]) => a - b)
    .slice(0, 3)
    .map(([, k]) => k);

  log.info({ picks }, "scraping trending keywords");

  for (const kw of picks) {
    try {
      await runShopeeScrape({
        keyword: kw,
        maxProducts: 30,
        fetchDetails: true,
        reviewsPerProduct: 15,
        orderBy: 5,
      });
    } catch (err) {
      log.error({ kw, err: errMsg(err) }, "scrape failed for keyword");
      await createAlert({
        severity: "warn",
        code: "scrape.keyword_failed",
        title: `Scrape failed: ${kw}`,
        body: errMsg(err),
      });
    }
  }
}

/* ===================================================================
 * 2. Generate pages for products that don't have one yet
 *    Prioritized by Layer 8 final_score (demand × profitability × seasonality)
 * =================================================================== */

export async function jobGeneratePages(maxPages = 50): Promise<void> {
  // Prefer scored products; fall back to sold_count if not yet scored
  const candidates = await db.execute<{ id: number }>(sql`
    SELECT p.id
      FROM products p
     WHERE p.is_active = true
       AND p.flag_blacklisted = false
       AND p.flag_regulated = false
       AND p.rating >= 4.0
       AND p.sold_count >= 50
       AND NOT EXISTS (
         SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id
       )
     ORDER BY
       p.final_score DESC NULLS LAST,
       p.sold_count DESC NULLS LAST,
       p.rating DESC NULLS LAST
     LIMIT ${maxPages}
  `);

  log.info({ count: candidates.length }, "generating pages");

  let success = 0;
  let failed = 0;
  for (const c of candidates) {
    try {
      await generateReviewPage({ productId: c.id });
      success++;
    } catch (err) {
      failed++;
      log.warn({ productId: c.id, err: errMsg(err) }, "page generation failed");
    }
  }

  log.info({ success, failed }, "page generation done");

  if (failed > success && candidates.length > 5) {
    await createAlert({
      severity: "error",
      code: "content.gen_failure_rate",
      title: "Content generation failure rate high",
      body: `${failed}/${candidates.length} pages failed in this run`,
    });
  }
}

/* ===================================================================
 * 3. Refresh prices for known products (lighter than full scrape)
 * =================================================================== */

export async function jobRefreshPrices(maxItems = 100): Promise<void> {
  // Re-scrape products not seen in 24h, prioritized by traffic
  const candidates = await db.execute<{ id: number; externalId: string }>(sql`
    SELECT id, external_id AS "externalId"
      FROM products
     WHERE is_active = true
       AND last_scraped_at < now() - interval '12 hours'
     ORDER BY clicks_30d DESC NULLS LAST, sold_count DESC NULLS LAST
     LIMIT ${maxItems}
  `);

  log.info({ count: candidates.length }, "refreshing prices");
  // Note: full implementation would call getItemDetail per product;
  // for Phase 1 we rely on jobScrapeTrending re-fetching products via search.
}

/* ===================================================================
 * 4. Telegram broadcast deals
 * =================================================================== */

export async function jobBroadcastDeals(): Promise<void> {
  const result = await broadcastDealsToChannel({ limit: 3, minDiscount: 0.25, minRating: 4.3 });
  log.info(result, "broadcast deals done");
}

/* ===================================================================
 * 5. Health check
 * =================================================================== */

export async function jobHealthCheck(): Promise<void> {
  await runHealthChecks();
}

/* ===================================================================
 * 6. Daily report
 * =================================================================== */

export async function jobDailyReport(): Promise<void> {
  await sendDailyReport();
}

/* ===================================================================
 * 7. Cleanup — old scrape runs, old click logs
 * =================================================================== */

export async function jobCleanup(): Promise<void> {
  await db
    .delete(schema.scraperRuns)
    .where(lt(schema.scraperRuns.startedAt, sql`now() - interval '30 days'`));
  await db
    .delete(schema.clicks)
    .where(lt(schema.clicks.occurredAt, sql`now() - interval '180 days'`));
  log.info("cleanup done");
}

/* ===================================================================
 * 8. Re-score all products (Layer 8 product intelligence)
 * =================================================================== */

export async function jobRescoreProducts(): Promise<void> {
  const result = await runScoring({ staleAfterMin: 180 });
  log.info(result, "rescore products done");
}

/* ===================================================================
 * Job registry
 * =================================================================== */

export const JOBS = {
  scrapeTrending: jobScrapeTrending,
  generatePages: jobGeneratePages,
  refreshPrices: jobRefreshPrices,
  broadcastDeals: jobBroadcastDeals,
  healthCheck: jobHealthCheck,
  dailyReport: jobDailyReport,
  cleanup: jobCleanup,
  rescoreProducts: jobRescoreProducts,
} as const;

export type JobName = keyof typeof JOBS;

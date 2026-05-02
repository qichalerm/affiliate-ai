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
import {
  generateComparisonPage,
  findComparisonCandidates,
} from "../content/comparison-generator.ts";
import { generateAllBestOfPages } from "../content/best-of-generator.ts";
import { publishPinsForTopProducts } from "../publisher/pinterest.ts";
import { runLazadaScrape } from "../scraper/lazada/runner.ts";
import { runCrossPlatformMatcher } from "../intelligence/cross-platform-matcher.ts";
import { buildSitemap } from "../seo/sitemap-builder.ts";
import { submitToIndexNow } from "../seo/indexnow.ts";
import { batchNotifyGoogle } from "../seo/google-indexing.ts";
import { refreshAllInternalLinks } from "../seo/internal-linker.ts";
import { runAnalyticsIngest } from "../analytics/runner.ts";
import { runSourceHealth } from "../monitoring/source-health.ts";
import { generateAllPriceComparePages } from "../content/price-compare-generator.ts";
import { publishThreadsForTopProducts } from "../publisher/twitter.ts";
import { sendWeeklyDigest } from "../publisher/email-newsletter.ts";
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
  const perRun = Math.max(1, env.SCRAPE_KEYWORDS_PER_RUN);
  // Pick N random keywords each run to spread coverage
  const picks = keywords
    .map((k) => [Math.random(), k] as const)
    .sort(([a], [b]) => a - b)
    .slice(0, perRun)
    .map(([, k]) => k);

  log.info({ picks, productsPerKeyword: env.SCRAPE_PRODUCTS_PER_KEYWORD }, "scraping trending keywords");

  let totalSucceeded = 0;
  for (const kw of picks) {
    try {
      const result = await runShopeeScrape({
        keyword: kw,
        maxProducts: env.SCRAPE_PRODUCTS_PER_KEYWORD,
        // Apify basic mode is the only working path; details/reviews are no-ops there.
        // Kept here for code-shape compat with the (currently disabled) direct path.
        fetchDetails: false,
        reviewsPerProduct: 0,
        orderBy: 5,
      });
      totalSucceeded += result.itemsSucceeded;
    } catch (err) {
      const msg = errMsg(err);
      // Budget exceeded is informational, not an error to alert on
      if (msg.includes("budget exceeded")) {
        log.warn({ kw }, "skipping keyword: apify budget exceeded for the day");
        break;
      }
      log.error({ kw, err: msg }, "scrape failed for keyword");
      await createAlert({
        severity: "warn",
        code: "scrape.keyword_failed",
        title: `Scrape failed: ${kw}`,
        body: msg,
      });
    }
  }

  // Trigger site rebuild so fresh prices/deals appear on the homepage within ~1-2 min.
  // Threshold of 5 avoids deploying for tiny changes (e.g. when budget cuts the run short).
  if (totalSucceeded >= 5) {
    await triggerSiteRebuild(`scrape:${totalSucceeded}_items`);
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
       -- Apify basic mode often returns sold_count=null/0 even for legit products,
       -- so use rating_count or discount as alternative "real product" signals
       AND (p.sold_count >= 20 OR p.rating_count >= 5 OR p.discount_percent >= 0.10 OR p.sold_count = 0)
       AND p.current_price > 0
       AND NOT EXISTS (
         SELECT 1 FROM content_pages cp WHERE cp.primary_product_id = p.id
       )
     ORDER BY
       p.final_score DESC NULLS LAST,
       p.sold_count DESC NULLS LAST,
       p.rating_count DESC NULLS LAST,
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

  // Trigger Astro rebuild + Cloudflare Pages deploy so new review pages go live.
  // Static site = baked at build time; without this, generated pages stay invisible.
  if (success > 0) {
    await triggerSiteRebuild(success);
  }
}

/**
 * Spawns `bun run build:pages` so the cron job returns quickly while
 * Astro+wrangler runs to completion. Output is piped to a log file
 * (was previously stdio:'ignore' which silently swallowed errors when
 * `bun` wasn't on the systemd PATH — easy footgun, fixed).
 */
async function triggerSiteRebuild(reason: number | string): Promise<void> {
  log.info({ reason }, "▶ triggering site rebuild + deploy");
  const { spawn } = await import("node:child_process");
  const { openSync, mkdirSync } = await import("node:fs");

  // systemd doesn't put /root/.bun/bin on PATH; use absolute path so spawn doesn't ENOENT.
  const BUN = "/root/.bun/bin/bun";
  const LOG_DIR = "/root/research-2/logs";
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
  const logPath = `${LOG_DIR}/auto-rebuild-${Date.now()}.log`;
  const out = openSync(logPath, "a");

  const proc = spawn(BUN, ["run", "build:pages"], {
    cwd: "/root/research-2",
    env: process.env,
    detached: true,
    stdio: ["ignore", out, out],
  });
  proc.unref();
  proc.on("error", (err) => {
    log.error({ err: errMsg(err), logPath }, "site rebuild spawn failed");
  });
  log.info({ pid: proc.pid, logPath }, "site rebuild spawned (background)");
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
 * 9. Generate comparison pages (A vs B in same category)
 * =================================================================== */

export async function jobGenerateComparisons(maxPages = 15): Promise<void> {
  const pairs = await findComparisonCandidates(maxPages);
  log.info({ pairs: pairs.length }, "generating comparison pages");
  let success = 0;
  let failed = 0;
  let totalCost = 0;
  for (const { aId, bId } of pairs) {
    try {
      const r = await generateComparisonPage({ productAId: aId, productBId: bId });
      totalCost += r.costUsd;
      if (r.status === "published" || r.status === "pending_review") success++;
    } catch (err) {
      failed++;
      log.warn({ aId, bId, err: errMsg(err) }, "comparison failed");
    }
  }
  log.info({ success, failed, totalCost: totalCost.toFixed(4) }, "comparisons done");

  // New comparison pages are static — must rebuild to surface them on the live site.
  if (success > 0) await triggerSiteRebuild(`comparisons:${success}`);
}

/* ===================================================================
 * 10. Generate best-of pages (top 5 per category × 4 variants)
 * =================================================================== */

export async function jobGenerateBestOf(): Promise<void> {
  const result = await generateAllBestOfPages();
  log.info(result, "best-of pages done");

  // Best-of lists are static pages at /ของดี/{slug} — rebuild so new ones appear.
  await triggerSiteRebuild("best-of");
}

/* ===================================================================
 * 11. Pinterest publishing (only when feature flag + token present)
 * =================================================================== */

export async function jobPinterestPublish(): Promise<void> {
  const result = await publishPinsForTopProducts({ limit: 20 });
  log.info(result, "pinterest publish done");
}

/* ===================================================================
 * 12. Lazada scrape (Wave 3)
 * =================================================================== */

const NICHE_KEYWORDS_LAZADA: Record<string, string[]> = {
  it_gadget: [
    "wireless earbuds",
    "gaming mouse",
    "mechanical keyboard",
    "powerbank",
    "phone case",
    "type c cable",
    "bluetooth speaker",
    "laptop stand",
  ],
  beauty: ["serum", "sunscreen", "lipstick", "face mask"],
  home: ["air fryer", "coffee machine", "rice cooker", "vacuum cleaner"],
  sports: ["dumbbell", "yoga mat", "running shoes"],
  mom_baby: ["diaper", "milk powder", "baby bottle", "stroller"],
};

export async function jobScrapeLazada(): Promise<void> {
  const keywords = NICHE_KEYWORDS_LAZADA[env.PRIMARY_NICHE] ?? NICHE_KEYWORDS_LAZADA.it_gadget;
  const picks = keywords
    .map((k) => [Math.random(), k] as const)
    .sort(([a], [b]) => a - b)
    .slice(0, 2) // smaller batch — Lazada is more sensitive
    .map(([, k]) => k);

  log.info({ picks }, "scraping lazada keywords");
  for (const kw of picks) {
    try {
      await runLazadaScrape({ keyword: kw, maxPages: 2, maxProducts: 30 });
    } catch (err) {
      log.error({ kw, err: errMsg(err) }, "lazada scrape failed");
      await createAlert({
        severity: "warn",
        code: "scrape.lazada_failed",
        title: `Lazada scrape failed: ${kw}`,
        body: errMsg(err),
      });
    }
  }
}

/* ===================================================================
 * 13. Cross-platform matcher (Shopee ↔ Lazada)
 * =================================================================== */

export async function jobCrossPlatformMatch(): Promise<void> {
  const result = await runCrossPlatformMatcher({ minScore: 0.4, limit: 500 });
  log.info(result, "cross-platform match done");
}

/* ===================================================================
 * 14. Sitemap rebuild + IndexNow + Google Indexing API
 * =================================================================== */

export async function jobSitemapAndIndex(): Promise<void> {
  // 1. Build sitemap files into web/public
  const sitemap = await buildSitemap();
  log.info(sitemap, "sitemap rebuilt");

  // 2. Trigger site rebuild + deploy so the freshly-written sitemap.xml lands on Cloudflare.
  // Without this, sitemap.xml only exists on the server and search engines see 404.
  await triggerSiteRebuild("sitemap");

  // 3. Find URLs published in last 24h to ping IndexNow + Google
  const recentUrls = await db.execute<{ slug: string; type: string }>(sql`
    SELECT slug, type::text AS type
      FROM content_pages
     WHERE status = 'published'
       AND COALESCE(updated_at, published_at) > now() - interval '24 hours'
     LIMIT 200
  `);
  const SITE = `https://${env.DOMAIN_NAME}`;
  const urls = recentUrls.map((p) => {
    const prefix =
      p.type === "review" ? "/รีวิว/" : p.type === "comparison" ? "/เปรียบเทียบ/" : "/ของดี/";
    return `${SITE}${prefix}${p.slug}`;
  });

  // 4. IndexNow (Bing + Yandex)
  const indexNow = await submitToIndexNow(urls);
  log.info(indexNow, "indexnow submitted");

  // 5. Google Indexing API (capped at 100/day to respect quota)
  const google = await batchNotifyGoogle(urls);
  log.info(google, "google indexing submitted");
}

/* ===================================================================
 * 15. Refresh internal links
 * =================================================================== */

export async function jobRefreshInternalLinks(): Promise<void> {
  const result = await refreshAllInternalLinks();
  log.info(result, "internal links refresh done");

  // Internal links are baked into content_json of static pages — rebuild to apply.
  await triggerSiteRebuild("internal-links");
}

/* ===================================================================
 * 16. Analytics ingestion (Layer 10 — GSC + CF + Short.io)
 * =================================================================== */

export async function jobAnalyticsIngest(): Promise<void> {
  const result = await runAnalyticsIngest();
  log.info(result, "analytics ingestion done");
}

/* ===================================================================
 * 17. Per-source health (hourly)
 * =================================================================== */

export async function jobSourceHealth(): Promise<void> {
  const signals = await runSourceHealth();
  const summary = signals.reduce(
    (acc, s) => {
      acc[s.status] = (acc[s.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  log.info(summary, "source health summary");
}

/* ===================================================================
 * 18. Cross-platform price compare pages
 * =================================================================== */

export async function jobGeneratePriceCompare(): Promise<void> {
  const result = await generateAllPriceComparePages({ limit: 30 });
  log.info(result, "price-compare pages done");
}

/* ===================================================================
 * 19. Twitter/X threads
 * =================================================================== */

export async function jobTwitterPublish(): Promise<void> {
  const result = await publishThreadsForTopProducts({ limit: 3 });
  log.info(result, "twitter publish done");
}

/* ===================================================================
 * 20. Email weekly digest
 * =================================================================== */

export async function jobEmailDigest(): Promise<void> {
  const result = await sendWeeklyDigest();
  log.info(result, "email digest sent");
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
  generateComparisons: jobGenerateComparisons,
  generateBestOf: jobGenerateBestOf,
  pinterestPublish: jobPinterestPublish,
  scrapeLazada: jobScrapeLazada,
  crossPlatformMatch: jobCrossPlatformMatch,
  sitemapAndIndex: jobSitemapAndIndex,
  refreshInternalLinks: jobRefreshInternalLinks,
  analyticsIngest: jobAnalyticsIngest,
  sourceHealth: jobSourceHealth,
  generatePriceCompare: jobGeneratePriceCompare,
  twitterPublish: jobTwitterPublish,
  emailDigest: jobEmailDigest,
} as const;

export type JobName = keyof typeof JOBS;

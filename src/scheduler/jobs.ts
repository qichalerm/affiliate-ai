/**
 * Scheduled jobs registry.
 * Each job is a pure async function — failures are logged but don't crash the scheduler.
 *
 * Sprint 2 jobs:
 *   - jobScrapeTrending: pick N keywords (multi-niche), run Apify scrape, persist
 */

import { runShopeeScrape } from "../scraper/shopee/runner.ts";
import { BudgetExceededError } from "../scraper/shopee/apify-client.ts";
import { runTikTokShopScrape } from "../scraper/tiktok-shop/runner.ts";
import { notifyShopeeVideoBacklog } from "../publisher/shopee-video.ts";
import { pickKeywords, pickKeywordsWeighted } from "../scraper/niches.ts";
import { runLearningOptimizer } from "../brain/learning.ts";
import { runPromoHunter } from "../brain/promo-hunter.ts";
import { runPromoTrigger } from "../brain/promo-trigger.ts";
import { runEngagementTracker } from "../engagement/tracker.ts";
import { runSourceHealthCheck } from "../monitoring/source-health.ts";
import { runDailyReport } from "../monitoring/daily-report.ts";
import { translateMissingProducts } from "../translation/translator.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("jobs");

/**
 * Scrape `SCRAPE_KEYWORDS_PER_RUN` random keywords across all enabled niches.
 * Stops early if Apify daily budget is hit.
 */
export async function jobScrapeTrending(): Promise<void> {
  // M9 niche budget rebalancer (Sprint 27): weight by recent click data.
  // Falls back to uniform random when DB query fails or all niches are
  // cold-start (no clicks yet → all weights = 1 = uniform).
  const picks = await pickKeywordsWeighted({ count: env.SCRAPE_KEYWORDS_PER_RUN });

  log.info(
    { picks: picks.map((p) => `${p.niche}:${p.keyword}`), perKeyword: env.SCRAPE_PRODUCTS_PER_KEYWORD },
    "scrapeTrending start",
  );

  let totalSucceeded = 0;
  let totalNew = 0;
  let totalCost = 0;

  for (const { niche, keyword } of picks) {
    try {
      const result = await runShopeeScrape({
        keyword,
        niche,
        maxProducts: env.SCRAPE_PRODUCTS_PER_KEYWORD,
      });
      totalSucceeded += result.succeeded;
      totalNew += result.newProducts;
      totalCost += result.costUsd;
      if (result.skippedReason) {
        log.warn({ keyword, reason: result.skippedReason }, "stop early — budget hit");
        break;
      }
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        log.warn({ keyword }, "stop early — budget hit");
        break;
      }
      log.error({ keyword, err: errMsg(err) }, "scrape failed for keyword");
    }
  }

  log.info(
    { totalSucceeded, totalNew, totalCostUsd: totalCost.toFixed(4) },
    "scrapeTrending done",
  );
}

/**
 * Shopee Video helper digest — Sprint 28. Emails operator with the
 * day's batch of ready-to-upload clips (Shopee has no posting API).
 */
export async function jobShopeeVideoDigest(): Promise<void> {
  const r = await notifyShopeeVideoBacklog();
  log.info(r, "shopeeVideoDigest done");
}

/**
 * TikTok Shop scrape — Sprint 26. No-op until TIKTOK_SHOP_ACTOR_ID set.
 */
export async function jobScrapeTikTokShop(): Promise<void> {
  if (!env.TIKTOK_SHOP_ACTOR_ID) {
    log.info("TIKTOK_SHOP_ACTOR_ID not set — skipping TikTok Shop scrape");
    return;
  }
  const picks = pickKeywords({ count: 2 });  // less aggressive than Shopee until validated
  for (const { niche, keyword } of picks) {
    try {
      await runTikTokShopScrape({ keyword, niche, maxProducts: env.SCRAPE_PRODUCTS_PER_KEYWORD });
    } catch (err) {
      log.error({ keyword, err: errMsg(err) }, "tiktok shop scrape failed");
    }
  }
}

/**
 * Nightly Learning Optimizer (M9). Aggregates yesterday's performance,
 * deactivates underperforming variants, writes insights for next day.
 */
export async function jobLearningOptimizer(): Promise<void> {
  const result = await runLearningOptimizer({ windowDays: 1 });
  log.info(result, "learningOptimizer done");
}

/**
 * Backfill multilingual translations for products missing one or more
 * target languages. Idempotent — already-translated products are skipped.
 * Triggers a site rebuild on success so EN/ZH/JA visitors stop seeing
 * Thai fallback as soon as new translations land.
 */
export async function jobBackfillTranslations(): Promise<void> {
  const result = await translateMissingProducts({ limit: 20 });
  log.info(result, "backfillTranslations done");
}

/**
 * Daily Operator Report. Aggregates yesterday's pipeline activity
 * (scrapes, promos, variants, clicks, alerts, top bandit picks) and
 * dispatches via stdout + file + optional email.
 */
export async function jobDailyReport(): Promise<void> {
  await runDailyReport();
}

/**
 * Source Health Monitor (M0). Detects silently-degrading scrapers
 * (stale, low success rate, cost-per-item spike) and writes alerts.
 */
export async function jobSourceHealth(): Promise<void> {
  const result = await runSourceHealthCheck();
  log.info(result, "sourceHealth done");
}

/**
 * Engagement Tracker (M7). For each recent published post, fetch
 * platform analytics and snapshot into post_metrics. No-op for posts
 * whose channel doesn't have a token yet (FB/IG depend on META, TikTok
 * on its own token).
 */
export async function jobEngagementTracker(): Promise<void> {
  const result = await runEngagementTracker();
  log.info(result, "engagementTracker done");
}

/**
 * Promo Hunter (M6). Scans active products for price/discount signals,
 * writes promo_events rows, then immediately triggers variant generation
 * for any pending events. Hunter + trigger run together so freshly-detected
 * promos turn into content within the same job window.
 */
export async function jobPromoHunter(): Promise<void> {
  const huntResult = await runPromoHunter({ windowHours: 24 });
  log.info(huntResult, "promoHunter done");

  // Chain: trigger variant generation for any pending events
  // (includes newly-detected ones from this run).
  try {
    const triggerResult = await runPromoTrigger({ batchSize: 5 });
    log.info(triggerResult, "promoTrigger done");
  } catch (err) {
    log.error({ err: errMsg(err) }, "promoTrigger failed (hunter results retained)");
  }
}

/**
 * Scheduled jobs registry.
 * Each job is a pure async function — failures are logged but don't crash the scheduler.
 *
 * Sprint 2 jobs:
 *   - jobScrapeTrending: pick N keywords (multi-niche), run Apify scrape, persist
 */

import { runShopeeScrape, BudgetExceededError } from "../scraper/shopee/runner.ts";
import { pickKeywords } from "../scraper/niches.ts";
import { runLearningOptimizer } from "../brain/learning.ts";
import { runPromoHunter } from "../brain/promo-hunter.ts";
import { runPromoTrigger } from "../brain/promo-trigger.ts";
import { runEngagementTracker } from "../engagement/tracker.ts";
import { runSourceHealthCheck } from "../monitoring/source-health.ts";
import { runDailyReport } from "../monitoring/daily-report.ts";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("jobs");

/**
 * Scrape `SCRAPE_KEYWORDS_PER_RUN` random keywords across all enabled niches.
 * Stops early if Apify daily budget is hit.
 */
export async function jobScrapeTrending(): Promise<void> {
  const picks = pickKeywords({ count: env.SCRAPE_KEYWORDS_PER_RUN });

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
 * Nightly Learning Optimizer (M9). Aggregates yesterday's performance,
 * deactivates underperforming variants, writes insights for next day.
 */
export async function jobLearningOptimizer(): Promise<void> {
  const result = await runLearningOptimizer({ windowDays: 1 });
  log.info(result, "learningOptimizer done");
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

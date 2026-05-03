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

/**
 * Per-target rate limiter — keeps scrapers polite.
 *
 * Strategy:
 *  - Token bucket per host (Shopee, etc.)
 *  - Background refill (continuous)
 *  - Configurable burst + sustained rates
 *  - Look "human": adds randomized jitter, occasional longer pauses
 *
 * Use:
 *   await rateLimit("shopee").acquire();
 *   const res = await fetch(...);
 */

import { sleep } from "../../lib/retry.ts";
import { child } from "../../lib/logger.ts";

const log = child("rate-limiter");

interface BucketConfig {
  /** Max requests in burst window. */
  burstMax: number;
  /** Sustained requests per second. */
  sustainedRps: number;
  /** Min delay between consecutive requests (ms). */
  minIntervalMs: number;
  /** Probability of taking a "human pause" (1-3s) on each request. */
  humanPauseProb: number;
}

const DEFAULT: BucketConfig = {
  burstMax: 6,
  sustainedRps: 0.5,
  minIntervalMs: 1500,
  humanPauseProb: 0.08,
};

const CONFIGS: Record<string, BucketConfig> = {
  shopee: {
    burstMax: 5,
    sustainedRps: 0.4,    // ~24 req/min
    minIntervalMs: 1500,
    humanPauseProb: 0.10,
  },
  shopee_dashboard: {
    // ULTRA conservative — Shopee bans dashboard scrapers fast
    burstMax: 2,
    sustainedRps: 0.05,   // ~3 req/min
    minIntervalMs: 8000,
    humanPauseProb: 0.30,
  },
  tiktok_api: {
    burstMax: 8,
    sustainedRps: 1.5,
    minIntervalMs: 600,
    humanPauseProb: 0.05,
  },
  meta_api: {
    burstMax: 10,
    sustainedRps: 2.0,
    minIntervalMs: 400,
    humanPauseProb: 0.02,
  },
  default: DEFAULT,
};

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private lastRequest = 0;

  constructor(private config: BucketConfig) {
    this.tokens = config.burstMax;
  }

  async acquire(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      const waitMs = Math.ceil(1000 / this.config.sustainedRps);
      await sleep(waitMs);
      this.refill();
    }

    // Enforce min interval between requests
    const sinceLast = Date.now() - this.lastRequest;
    if (sinceLast < this.config.minIntervalMs) {
      const wait = this.config.minIntervalMs - sinceLast;
      const jitter = Math.random() * 800;
      await sleep(wait + jitter);
    }

    // Random "human pause"
    if (Math.random() < this.config.humanPauseProb) {
      const pauseMs = 1500 + Math.random() * 4000;
      log.debug({ pauseMs: Math.floor(pauseMs) }, "human pause");
      await sleep(pauseMs);
    }

    this.tokens -= 1;
    this.lastRequest = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const newTokens = elapsed * this.config.sustainedRps;
    this.tokens = Math.min(this.config.burstMax, this.tokens + newTokens);
    this.lastRefill = now;
  }
}

const buckets = new Map<string, TokenBucket>();

export function rateLimit(target: string): { acquire: () => Promise<void> } {
  if (!buckets.has(target)) {
    const config = CONFIGS[target] ?? DEFAULT;
    buckets.set(target, new TokenBucket(config));
  }
  return { acquire: () => buckets.get(target)!.acquire() };
}

/**
 * Insert a longer "thinking pause" between distinct browse-like actions.
 * E.g., after fetching a search page, pause 3-8s before fetching individual items.
 */
export async function browseSessionPause(): Promise<void> {
  const ms = 3000 + Math.random() * 5000;
  await sleep(ms);
}

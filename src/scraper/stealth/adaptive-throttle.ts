/**
 * Adaptive throttle — auto-slows scraper when error rate spikes.
 *
 * Why: Static rate limits don't react to real-world signal. If Shopee starts
 * 429-ing or 403-ing, we should back off automatically instead of plowing
 * through and getting banned.
 *
 * Strategy:
 *  - Sliding window of last 50 requests per host
 *  - If error rate > threshold → multiply baseline delay by penalty factor
 *  - Recovery: error rate < threshold for 10 minutes → restore baseline
 *  - Hard pause: 5 errors in a row → pause that host for 15 minutes
 */

import { sleep } from "../../lib/retry.ts";
import { child } from "../../lib/logger.ts";
import { createAlert } from "../../monitoring/alerts.ts";

const log = child("adaptive-throttle");

interface HostState {
  recentResults: boolean[]; // true = success, false = failure
  consecutiveFailures: number;
  pausedUntil: number;
  penaltyMultiplier: number;
  lastErrorAt: number;
  lastRecalcAt: number;
}

const WINDOW_SIZE = 50;
const ERROR_THRESHOLD = 0.20; // 20% errors → throttle
const HARD_PAUSE_FAILURES = 5;
const HARD_PAUSE_MS = 15 * 60_000;
const MAX_PENALTY = 8; // delays up to 8x baseline

const states = new Map<string, HostState>();

function getState(host: string): HostState {
  let state = states.get(host);
  if (!state) {
    state = {
      recentResults: [],
      consecutiveFailures: 0,
      pausedUntil: 0,
      penaltyMultiplier: 1,
      lastErrorAt: 0,
      lastRecalcAt: 0,
    };
    states.set(host, state);
  }
  return state;
}

/** Record outcome of a request. Adjusts throttle accordingly. */
export function recordResult(host: string, ok: boolean): void {
  const state = getState(host);
  state.recentResults.push(ok);
  if (state.recentResults.length > WINDOW_SIZE) state.recentResults.shift();

  if (ok) {
    state.consecutiveFailures = 0;
  } else {
    state.consecutiveFailures++;
    state.lastErrorAt = Date.now();

    if (state.consecutiveFailures >= HARD_PAUSE_FAILURES) {
      state.pausedUntil = Date.now() + HARD_PAUSE_MS;
      log.error(
        { host, failures: state.consecutiveFailures, pauseMs: HARD_PAUSE_MS },
        "scraper hard-paused (consecutive failures)",
      );
      void createAlert({
        severity: "error",
        code: "scraper.hard_paused",
        title: `Scraper paused: ${host}`,
        body: `${state.consecutiveFailures} consecutive failures. Paused for 15 minutes. Likely IP block — check proxy / fingerprint.`,
        requiresUserAction: true,
      }).catch(() => undefined);
    }
  }

  recalcPenalty(host, state);
}

function recalcPenalty(host: string, state: HostState): void {
  // Don't recompute too often
  if (Date.now() - state.lastRecalcAt < 5_000) return;
  state.lastRecalcAt = Date.now();

  if (state.recentResults.length < 10) return; // not enough signal

  const errorRate =
    state.recentResults.filter((r) => !r).length / state.recentResults.length;

  const previousPenalty = state.penaltyMultiplier;

  if (errorRate > 0.5) {
    state.penaltyMultiplier = MAX_PENALTY;
  } else if (errorRate > 0.30) {
    state.penaltyMultiplier = 4;
  } else if (errorRate > ERROR_THRESHOLD) {
    state.penaltyMultiplier = 2;
  } else if (errorRate < 0.05 && state.penaltyMultiplier > 1) {
    // Recovery
    state.penaltyMultiplier = Math.max(1, state.penaltyMultiplier * 0.7);
    if (state.penaltyMultiplier < 1.1) state.penaltyMultiplier = 1;
  }

  if (Math.abs(state.penaltyMultiplier - previousPenalty) > 0.5) {
    log.warn(
      {
        host,
        errorRate: errorRate.toFixed(2),
        penaltyMultiplier: state.penaltyMultiplier.toFixed(1),
      },
      "throttle adjusted",
    );
  }
}

/**
 * Wait based on current penalty + check hard-pause status.
 * Call before each request alongside the rate limiter.
 */
export async function waitForThrottle(host: string, baseDelayMs: number): Promise<void> {
  const state = getState(host);

  // Hard pause check
  const now = Date.now();
  if (state.pausedUntil > now) {
    const wait = state.pausedUntil - now;
    log.warn({ host, wait }, "host hard-paused; waiting");
    await sleep(wait);
    state.pausedUntil = 0;
    state.consecutiveFailures = 0;
  }

  // Adaptive penalty
  if (state.penaltyMultiplier > 1) {
    const extra = baseDelayMs * (state.penaltyMultiplier - 1);
    await sleep(extra);
  }
}

export function throttleStats(host: string): {
  errorRate: number;
  penaltyMultiplier: number;
  paused: boolean;
  consecutiveFailures: number;
} {
  const state = getState(host);
  const errorRate =
    state.recentResults.length === 0
      ? 0
      : state.recentResults.filter((r) => !r).length / state.recentResults.length;
  return {
    errorRate,
    penaltyMultiplier: state.penaltyMultiplier,
    paused: state.pausedUntil > Date.now(),
    consecutiveFailures: state.consecutiveFailures,
  };
}

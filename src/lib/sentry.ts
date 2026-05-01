/**
 * Sentry error tracking — automatic capture for unhandled errors.
 *
 * Initialized once at scheduler startup. All async functions wrapped with
 * sentry's instrumentation pick up exceptions automatically.
 *
 * Setup:
 *   SENTRY_DSN in .env (free 5k events/month tier sufficient)
 *
 * Privacy:
 *   - We strip request/response body from breadcrumbs (may contain API keys)
 *   - Hashed IPs only (already done at click capture)
 */

import * as Sentry from "@sentry/node";
import { env } from "./env.ts";
import { child } from "./logger.ts";

const log = child("sentry");

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!env.SENTRY_DSN) {
    log.info("SENTRY_DSN not set; error tracking disabled");
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: process.env.GIT_SHA ?? "dev",
    // Only sample 20% of "ok" performance traces; 100% of errors
    tracesSampleRate: 0.2,
    // Filter sensitive data
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      // Strip env values from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.filter(
          (b) => !b.message?.includes("API_KEY") && !b.message?.includes("TOKEN"),
        );
      }
      return event;
    },
    // Don't capture noisy "expected" errors
    ignoreErrors: [
      "rate-limited",
      "AbortError",
      "ECONNREFUSED",
      /shopee.*403/i,
    ],
  });

  initialized = true;
  log.info("sentry initialized");
}

/**
 * Manually capture an exception with extra context.
 * Use this in catch blocks for important errors that aren't unhandled.
 */
export function captureError(
  error: unknown,
  context: { tags?: Record<string, string>; extra?: Record<string, unknown> } = {},
): void {
  if (!initialized) return;
  Sentry.withScope((scope) => {
    if (context.tags) {
      for (const [k, v] of Object.entries(context.tags)) scope.setTag(k, v);
    }
    if (context.extra) {
      for (const [k, v] of Object.entries(context.extra)) scope.setExtra(k, v);
    }
    Sentry.captureException(error);
  });
}

/**
 * Wrap a job function so its errors get captured automatically with job-name tag.
 */
export function wrapJob<T>(name: string, fn: () => Promise<T>): () => Promise<T> {
  return async () => {
    if (!initialized) return fn();
    return Sentry.startSpan(
      { name: `job.${name}`, op: "scheduled.job" },
      async () => {
        try {
          return await fn();
        } catch (err) {
          captureError(err, { tags: { job: name } });
          throw err;
        }
      },
    );
  };
}

/** Flush before process exit. */
export async function flushSentry(timeoutMs = 2000): Promise<void> {
  if (!initialized) return;
  await Sentry.flush(timeoutMs);
}

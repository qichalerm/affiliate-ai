import { child } from "./logger.ts";

const log = child("retry");

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  onAttempt?: (attempt: number, error: unknown) => void;
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Retry an async operation with exponential backoff + jitter.
 */
export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!shouldRetry(err) || attempt === attempts) {
        throw err;
      }
      const exp = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jitter = Math.random() * exp * 0.3;
      const delay = Math.floor(exp + jitter);
      opts.onAttempt?.(attempt, err);
      log.debug({ attempt, delay, err: errMsg(err) }, "retrying");
      await sleep(delay);
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

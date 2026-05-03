/**
 * Retry helpers — exponential backoff with jitter.
 * Used for any external API call (Apify, Anthropic, social platforms, ...).
 */

export interface RetryOptions {
  /** Total attempts including first try. */
  attempts?: number;
  /** Base delay before first retry, ms. */
  baseDelayMs?: number;
  /** Max delay between attempts, ms. */
  maxDelayMs?: number;
  /** Called before each retry — return false to abort. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
}

export async function retry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (!shouldRetry(err, i + 1)) break;

      const exp = Math.min(baseDelayMs * 2 ** i, maxDelayMs);
      const jittered = exp / 2 + Math.random() * (exp / 2);
      await sleep(jittered);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

export function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

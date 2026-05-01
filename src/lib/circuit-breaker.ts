/**
 * Circuit breaker — protect external services from cascading failures.
 *
 * States:
 *  - CLOSED: normal operation
 *  - OPEN: too many failures, requests fail fast
 *  - HALF_OPEN: probing — let one through to test recovery
 *
 * Use:
 *   const breaker = getBreaker("anthropic");
 *   await breaker.execute(() => anthropic.messages.create(...));
 *
 * Tunable per service via `configure()`.
 */

import { child } from "./logger.ts";
import { errMsg } from "./retry.ts";

const log = child("circuit-breaker");

interface BreakerConfig {
  /** Failures within window to trip. */
  failureThreshold: number;
  /** Time window for counting failures (ms). */
  windowMs: number;
  /** How long to stay open before probing. */
  cooldownMs: number;
}

const DEFAULT_CONFIG: BreakerConfig = {
  failureThreshold: 5,
  windowMs: 60_000,
  cooldownMs: 60_000,
};

const SERVICE_CONFIGS: Record<string, BreakerConfig> = {
  anthropic: { failureThreshold: 5, windowMs: 120_000, cooldownMs: 30_000 },
  shopee: { failureThreshold: 8, windowMs: 60_000, cooldownMs: 300_000 }, // 5min cooldown if fully tripped
  lazada: { failureThreshold: 5, windowMs: 60_000, cooldownMs: 600_000 }, // longer — Lazada bans last
  pinterest: { failureThreshold: 5, windowMs: 120_000, cooldownMs: 60_000 },
  tiktok: { failureThreshold: 4, windowMs: 60_000, cooldownMs: 120_000 },
  meta: { failureThreshold: 5, windowMs: 60_000, cooldownMs: 120_000 },
  shortio: { failureThreshold: 8, windowMs: 60_000, cooldownMs: 30_000 },
  default: DEFAULT_CONFIG,
};

class CircuitBreaker {
  private state: "CLOSED" | "OPEN" | "HALF_OPEN" = "CLOSED";
  private failures: number[] = []; // timestamps
  private openedAt = 0;

  constructor(public readonly name: string, private config: BreakerConfig) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.updateState();

    if (this.state === "OPEN") {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      if (this.state === "HALF_OPEN") {
        this.reset();
        log.info({ service: this.name }, "circuit closed (recovery)");
      }
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  private updateState(): void {
    const now = Date.now();
    // Prune old failures
    this.failures = this.failures.filter((ts) => now - ts < this.config.windowMs);

    if (this.state === "OPEN" && now - this.openedAt > this.config.cooldownMs) {
      this.state = "HALF_OPEN";
      log.info({ service: this.name }, "circuit half-open (probe)");
    }
  }

  private recordFailure(): void {
    const now = Date.now();
    this.failures.push(now);
    this.failures = this.failures.filter((ts) => now - ts < this.config.windowMs);

    if (this.state === "HALF_OPEN") {
      // probe failed — back to OPEN
      this.state = "OPEN";
      this.openedAt = now;
      log.warn({ service: this.name }, "circuit re-opened (probe failed)");
    } else if (this.failures.length >= this.config.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = now;
      log.error(
        { service: this.name, failures: this.failures.length },
        "circuit OPEN — failing fast",
      );
    }
  }

  private reset(): void {
    this.state = "CLOSED";
    this.failures = [];
    this.openedAt = 0;
  }

  status(): { state: string; recentFailures: number; openedAt?: Date } {
    this.updateState();
    return {
      state: this.state,
      recentFailures: this.failures.length,
      openedAt: this.openedAt > 0 ? new Date(this.openedAt) : undefined,
    };
  }
}

export class CircuitOpenError extends Error {
  constructor(public readonly service: string) {
    super(`Circuit OPEN for ${service} — failing fast`);
    this.name = "CircuitOpenError";
  }
}

const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string): CircuitBreaker {
  let breaker = breakers.get(name);
  if (!breaker) {
    breaker = new CircuitBreaker(name, SERVICE_CONFIGS[name] ?? DEFAULT_CONFIG);
    breakers.set(name, breaker);
  }
  return breaker;
}

export function allBreakerStatus(): Record<string, ReturnType<CircuitBreaker["status"]>> {
  const out: Record<string, ReturnType<CircuitBreaker["status"]>> = {};
  for (const [name, b] of breakers) out[name] = b.status();
  return out;
}

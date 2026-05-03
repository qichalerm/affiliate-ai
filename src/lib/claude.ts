/**
 * Anthropic Claude wrapper.
 * Three model tiers (configured via env):
 *   FAST   — Haiku 4.5  ($0.80/M input, $4/M output) — bulk content gen
 *   SMART  — Sonnet 4.6 ($3/M, $15/M)                — decisions, comparisons
 *   PRO    — Opus 4.7   ($15/M, $75/M)               — strategic insights
 *
 * Cost tracking: every call logged so M9 can see cumulative spend per task type.
 * Daily cap enforcement: throws BudgetExceededError if today's spend > DAILY_LLM_BUDGET_USD.
 */

import Anthropic from "@anthropic-ai/sdk";
import { sql } from "drizzle-orm";
import { db, schema } from "./db.ts";
import { env } from "./env.ts";
import { child } from "./logger.ts";

const log = child("claude");

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export type ModelTier = "fast" | "smart" | "pro";

const MODELS: Record<ModelTier, string> = {
  fast: env.ANTHROPIC_MODEL_FAST,
  smart: env.ANTHROPIC_MODEL_SMART,
  pro: env.ANTHROPIC_MODEL_PRO,
};

// Pricing as of 2026-05 (per 1M tokens)
const PRICING: Record<
  ModelTier,
  { inputPerM: number; outputPerM: number; cacheReadPerM?: number; cacheWritePerM?: number }
> = {
  fast:  { inputPerM: 0.80, outputPerM: 4.00,  cacheReadPerM: 0.08, cacheWritePerM: 1.00 },
  smart: { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  pro:   { inputPerM: 15.00, outputPerM: 75.00, cacheReadPerM: 1.50, cacheWritePerM: 18.75 },
};

export class LlmBudgetExceededError extends Error {
  constructor(public spentUsd: number, public capUsd: number) {
    super(`LLM daily budget exceeded: $${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}`);
    this.name = "LlmBudgetExceededError";
  }
}

/**
 * Sum of LLM cost spent today (UTC date) from generation_runs.
 * Used to enforce DAILY_LLM_BUDGET_USD as a soft cap.
 */
async function todayLlmSpendUsd(): Promise<number> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [row] = await db.execute<{ totalMicros: number; [k: string]: unknown }>(sql`
    SELECT COALESCE(SUM(cost_usd_micros), 0)::bigint AS "totalMicros"
    FROM generation_runs
    WHERE provider = 'anthropic'
      AND created_at >= ${today.toISOString()}::timestamptz
  `);
  return row?.totalMicros ? Number(row.totalMicros) / 1_000_000 : 0;
}

export interface CompleteOptions {
  /** Tier — selects model. Default: fast (Haiku). */
  tier?: ModelTier;
  /** System prompt (cached if >1024 tokens). */
  system?: string;
  /** User message (single-turn). */
  prompt: string;
  /** Max tokens to generate. */
  maxTokens?: number;
  /** Temperature 0-1. Lower = more deterministic. */
  temperature?: number;
  /** Stop sequences. */
  stopSequences?: string[];
  /** Free-form tag for cost tracking — e.g. "quality_gate.toxicity". */
  task?: string;
}

export interface CompleteResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stopReason: string | null;
}

/**
 * One-shot text completion. Throws LlmBudgetExceededError if daily cap hit.
 */
export async function complete(opts: CompleteOptions): Promise<CompleteResult> {
  const tier: ModelTier = opts.tier ?? "fast";
  const model = MODELS[tier];

  // Soft budget check
  const spent = await todayLlmSpendUsd();
  if (spent >= env.DAILY_LLM_BUDGET_USD) {
    throw new LlmBudgetExceededError(spent, env.DAILY_LLM_BUDGET_USD);
  }

  const start = Date.now();

  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
    stop_sequences: opts.stopSequences,
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;

  const pricing = PRICING[tier];
  const costUsd =
    (inputTokens / 1_000_000) * pricing.inputPerM +
    (outputTokens / 1_000_000) * pricing.outputPerM;

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const durationMs = Date.now() - start;

  // Persist per-call cost so daily reports + budget gate work
  try {
    await db.insert(schema.generationRuns).values({
      task: opts.task ?? "claude.complete",
      provider: "anthropic",
      model,
      inputTokens,
      outputTokens,
      costUsdMicros: Math.round(costUsd * 1_000_000),
      durationMs,
      success: true,
    });
  } catch (err) {
    // Don't fail the call if logging fails — log and continue.
    log.warn({ err: err instanceof Error ? err.message : String(err) }, "generation_runs insert failed");
  }

  log.debug(
    {
      task: opts.task,
      tier,
      inputTokens,
      outputTokens,
      costUsd: costUsd.toFixed(6),
      durationMs,
    },
    "claude.complete",
  );

  return {
    text,
    model,
    inputTokens,
    outputTokens,
    costUsd,
    stopReason: response.stop_reason,
  };
}

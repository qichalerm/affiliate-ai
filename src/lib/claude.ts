import Anthropic from "@anthropic-ai/sdk";
import { env, can } from "./env.ts";
import { child } from "./logger.ts";
import { retry, errMsg } from "./retry.ts";
import { getBreaker } from "./circuit-breaker.ts";

const log = child("claude");

let _client: Anthropic | undefined;

function client(): Anthropic {
  if (!can.generateContent()) {
    throw new Error("ANTHROPIC_API_KEY not configured — content generation disabled");
  }
  if (!_client) {
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export type ClaudeTier = "fast" | "smart" | "pro";

export interface CompleteOptions {
  tier?: ClaudeTier;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** Force JSON object output via prefill technique. */
  jsonMode?: boolean;
  cacheSystem?: boolean;
  /** Enable extended thinking (Pro tier only). Token budget defaults to env. */
  extendedThinking?: boolean;
  /** Override thinking budget tokens. */
  thinkingBudget?: number;
}

export interface CompleteResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  cacheHit: boolean;
}

/**
 * Pricing (USD per 1M tokens) — adjust if pricing changes.
 * Includes prompt-cache rate.
 */
const PRICING: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> =
  {
    "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
    "claude-sonnet-4-6": { in: 3.0, out: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
    "claude-opus-4-7": { in: 15.0, out: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  };

function modelFor(tier: ClaudeTier): string {
  switch (tier) {
    case "pro":
      return env.ANTHROPIC_MODEL_PRO;
    case "smart":
      return env.ANTHROPIC_MODEL_SMART;
    default:
      return env.ANTHROPIC_MODEL_FAST;
  }
}

function priceFor(model: string) {
  return (
    PRICING[model] ?? {
      in: 1.0,
      out: 5.0,
      cacheRead: 0.1,
      cacheWrite: 1.25,
    }
  );
}

/**
 * Single-turn completion. Handles caching, JSON-mode, retry/backoff.
 */
export async function complete(prompt: string, opts: CompleteOptions = {}): Promise<CompleteResult> {
  const model = modelFor(opts.tier ?? "fast");

  const system = opts.system
    ? opts.cacheSystem
      ? [{ type: "text" as const, text: opts.system, cache_control: { type: "ephemeral" as const } }]
      : opts.system
    : undefined;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  if (opts.jsonMode && !opts.extendedThinking) {
    // Prefill is incompatible with extended thinking — skip if thinking enabled
    messages.push({ role: "assistant", content: "{" });
  }

  // Extended thinking (Opus 4.7 "adaptive" mode) — only Pro tier
  const useThinking = (opts.tier === "pro" && opts.extendedThinking) ?? false;
  const thinkingBudget = opts.thinkingBudget ?? env.ANTHROPIC_PRO_THINKING_BUDGET;

  const breaker = getBreaker("anthropic");
  const response = await breaker.execute(() => retry(
    () =>
      client().messages.create({
        model,
        max_tokens: opts.maxTokens ?? (useThinking ? Math.max(2048, thinkingBudget + 1024) : 1024),
        temperature: useThinking ? 1 : opts.temperature ?? 0.4, // thinking requires temp=1
        ...(system ? { system } : {}),
        ...(useThinking
          ? {
              thinking: {
                type: "enabled" as const,
                budget_tokens: thinkingBudget,
              },
            }
          : {}),
        messages,
      } as Anthropic.MessageCreateParamsNonStreaming),
    {
      attempts: 4,
      baseDelayMs: 1_000,
      shouldRetry: (err) => {
        const status = (err as { status?: number })?.status;
        return status === undefined || status >= 500 || status === 429;
      },
      onAttempt: (attempt, err) =>
        log.warn({ attempt, err: errMsg(err) }, "claude retry"),
    },
  ));

  const block = response.content.find((c): c is Anthropic.TextBlock => c.type === "text");
  let text = block?.text ?? "";
  if (opts.jsonMode && !useThinking) text = `{${text}`;

  const usage = response.usage;
  const cacheRead = (usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
  const cacheWrite =
    (usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0;
  const inputTokens = usage.input_tokens + cacheRead + cacheWrite;
  const outputTokens = usage.output_tokens;
  const p = priceFor(model);
  const costUsd =
    (usage.input_tokens * p.in +
      cacheRead * p.cacheRead +
      cacheWrite * p.cacheWrite +
      outputTokens * p.out) /
    1_000_000;

  log.debug(
    { model, inputTokens, outputTokens, cacheRead, costUsd: costUsd.toFixed(4) },
    "claude complete",
  );

  return {
    text,
    inputTokens,
    outputTokens,
    costUsd,
    model,
    cacheHit: cacheRead > 0,
  };
}

/**
 * Generate JSON output, validate against a parser/schema, retry on parse failure.
 */
export async function completeJson<T>(
  prompt: string,
  parse: (raw: string) => T,
  opts: CompleteOptions = {},
): Promise<{ data: T; result: CompleteResult }> {
  const result = await complete(prompt, { ...opts, jsonMode: true });
  try {
    return { data: parse(result.text), result };
  } catch (err) {
    log.warn({ err: errMsg(err), raw: result.text.slice(0, 200) }, "JSON parse failed, retrying");
    const retryResult = await complete(`${prompt}\n\nReturn ONLY valid JSON.`, {
      ...opts,
      jsonMode: true,
      temperature: 0.1,
    });
    return { data: parse(retryResult.text), result: retryResult };
  }
}

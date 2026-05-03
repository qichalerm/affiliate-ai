/**
 * Claude-based content moderator.
 *
 * Last-line-of-defense against subtle issues that pattern matching misses:
 *   - Implied medical claims ("ช่วยให้คุณรู้สึกดีขึ้น" — borderline)
 *   - Brand safety (mentions controversial events without naming)
 *   - Cultural insensitivity (Thai context matters)
 *   - Tone (overly aggressive sales, manipulative urgency)
 *
 * Uses Haiku (fast + cheap) — ~$0.001 per check.
 * Returns structured JSON via prompt engineering (no tool-use needed).
 */

import { complete } from "../lib/claude.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";

const log = child("quality.moderator");

export interface ModerationResult {
  safe: boolean;
  /** 0-100 — composite score, lower = safer. */
  riskScore: number;
  /** List of specific issues found. */
  issues: string[];
  /** Suggestion to fix (if any). */
  fixHint?: string;
  /** Cost of the check. */
  costUsd: number;
}

const MODERATOR_SYSTEM = `You are a content safety reviewer for a Thai affiliate marketing site.

Evaluate the input text for these issues:
1. MEDICAL: implied or explicit health claims (cure, treat, guarantee outcome)
2. FINANCIAL: get-rich-quick, predatory loans, unrealistic returns
3. BRAND: politics, religion, controversial figures (Thai or international)
4. AGGRESSIVE: manipulative urgency, fear-mongering, dishonest scarcity
5. MISLEADING: false comparisons, fake reviews, fake celebrity endorsements

Reply with strict JSON, no markdown, no preamble:
{
  "safe": true|false,
  "risk_score": 0-100,
  "issues": ["specific issue 1", "..."],
  "fix_hint": "how to rewrite if not safe (optional, omit if safe)"
}

risk_score guidance:
  0-20  = clean, no issues
  21-50 = minor concerns, allow but log
  51-80 = needs fix, fail gate
  81-100 = block, do not retry`;

export async function moderateContent(text: string): Promise<ModerationResult> {
  try {
    const res = await complete({
      tier: "fast",
      system: MODERATOR_SYSTEM,
      prompt: `Text to review:\n\n${text}`,
      maxTokens: 400,
      temperature: 0.0,  // deterministic — same input → same verdict
      task: "quality_gate.moderation",
    });

    // Extract first JSON object — Claude sometimes adds markdown/explanation
    // after the JSON, so we can't just JSON.parse the whole response.
    const cleaned = res.text.replace(/^```(?:json)?\s*/i, "");
    const firstBrace = cleaned.indexOf("{");
    if (firstBrace === -1) {
      log.warn({ rawResponse: cleaned.slice(0, 200) }, "moderator: no JSON found");
      return { safe: false, riskScore: 100, issues: ["moderator: no JSON in response"], costUsd: res.costUsd };
    }
    // Walk braces to find matching close (handles nested objects)
    let depth = 0;
    let endIdx = -1;
    for (let i = firstBrace; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { endIdx = i; break; }
      }
    }
    if (endIdx === -1) {
      log.warn({ rawResponse: cleaned.slice(0, 200) }, "moderator: unterminated JSON");
      return { safe: false, riskScore: 100, issues: ["moderator: unterminated JSON"], costUsd: res.costUsd };
    }

    let parsed: {
      safe: boolean;
      risk_score: number;
      issues: string[];
      fix_hint?: string;
    };
    try {
      parsed = JSON.parse(cleaned.slice(firstBrace, endIdx + 1));
    } catch (parseErr) {
      log.warn(
        { snippet: cleaned.slice(firstBrace, endIdx + 1).slice(0, 200), err: errMsg(parseErr) },
        "moderator JSON parse failed",
      );
      return {
        safe: false,
        riskScore: 100,
        issues: ["moderator returned malformed JSON"],
        costUsd: res.costUsd,
      };
    }

    return {
      safe: Boolean(parsed.safe) && parsed.risk_score <= 50,
      riskScore: Math.max(0, Math.min(100, Number(parsed.risk_score) || 0)),
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      fixHint: parsed.fix_hint,
      costUsd: res.costUsd,
    };
  } catch (err) {
    log.error({ err: errMsg(err) }, "moderator API call failed");
    // Fail-closed if moderator itself fails — better safe than sorry
    return {
      safe: false,
      riskScore: 100,
      issues: [`moderator unreachable: ${errMsg(err)}`],
      costUsd: 0,
    };
  }
}

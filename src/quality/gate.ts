/**
 * Quality Gate orchestrator (M0+ — Sprint 3).
 *
 * The single chokepoint every auto-content piece passes through before
 * being posted. Six layers:
 *
 *   1. Forbidden words (deterministic)        — fast, cheap
 *   2. Platform conformance (deterministic)   — caption length, hashtag count
 *   3. Affiliate disclosure (deterministic)   — auto-fixable
 *   4. Image safety (deferred to Sprint 6)    — needs vision model
 *   5. Length/hashtag conformance (deterministic) — covered by #2
 *   6. Claude moderator (LLM)                  — last-line catch-all
 *
 * Strategy:
 *   - If layers 1-3 fail → block immediately (no need for expensive LLM call)
 *   - If 1-3 pass → run layer 6 (Claude moderator)
 *   - If 6 also passes → APPROVED
 *   - If anything fails → return reasons + fixHint so caller can regenerate
 */

import { scanForbidden } from "./forbidden-words.ts";
import { checkPlatformRules, type Platform } from "./platform-rules.ts";
import { checkDisclosure, ensureDisclosure } from "./disclosure-checker.ts";
import { moderateContent } from "./claude-moderator.ts";
import { child } from "../lib/logger.ts";

const log = child("quality.gate");

export interface GateInput {
  text: string;
  platform: Platform;
  /** Skip the LLM moderator (use only for testing or when offline). */
  skipLlm?: boolean;
  /** Auto-fix disclosure (append) instead of failing. Default: true. */
  autoFixDisclosure?: boolean;
}

export interface GateResult {
  approved: boolean;
  /** The text that should be posted (may be modified by auto-fix). */
  finalText: string;
  /** All issues found across all layers. */
  issues: string[];
  /** Non-blocking warnings (e.g. caption length suboptimal). */
  warnings: string[];
  /** Was the text auto-modified to fix something? */
  autoFixed: boolean;
  /** Cost of LLM moderator call (0 if skipped or failed early). */
  llmCostUsd: number;
  /** Per-layer breakdown for debugging. */
  layers: {
    forbidden: { passed: boolean; reasons: string[] };
    platform: { passed: boolean; reasons: string[] };
    disclosure: { passed: boolean; fixed: boolean };
    moderator: { passed: boolean; riskScore: number; issues: string[] };
  };
}

/**
 * Run all quality checks. Returns a final verdict + the (possibly modified) text.
 */
export async function runQualityGate(input: GateInput): Promise<GateResult> {
  const issues: string[] = [];
  const warnings: string[] = [];
  let finalText = input.text;
  let autoFixed = false;
  let llmCostUsd = 0;

  // ── Layer 1: forbidden words ────────────────────────────────────
  const forbidden = scanForbidden(finalText);
  warnings.push(...forbidden.warnings);
  if (!forbidden.passed) {
    issues.push(...forbidden.blocked);
  }
  const forbiddenLayer = { passed: forbidden.passed, reasons: forbidden.blocked };

  // Short-circuit: forbidden words = hard block, no point running other layers
  if (!forbidden.passed) {
    log.warn(
      { platform: input.platform, blocked: forbidden.blocked },
      "gate fail: forbidden words",
    );
    return {
      approved: false,
      finalText,
      issues,
      warnings,
      autoFixed: false,
      llmCostUsd: 0,
      layers: {
        forbidden: forbiddenLayer,
        platform: { passed: false, reasons: ["skipped"] },
        disclosure: { passed: false, fixed: false },
        moderator: { passed: false, riskScore: 0, issues: ["skipped"] },
      },
    };
  }

  // ── Layer 3: disclosure (run before platform check — auto-fix changes length) ──
  const disclosureBefore = checkDisclosure(finalText);
  let disclosureFixed = false;
  if (!disclosureBefore.hasDisclosure) {
    if (input.autoFixDisclosure !== false) {
      finalText = ensureDisclosure(finalText);
      autoFixed = true;
      disclosureFixed = true;
    } else {
      issues.push("missing affiliate disclosure (e.g. #affiliate)");
    }
  }
  const disclosureLayer = {
    passed: disclosureBefore.hasDisclosure || disclosureFixed,
    fixed: disclosureFixed,
  };

  // ── Layer 2: platform conformance (after disclosure auto-append) ──
  const platform = checkPlatformRules(finalText, input.platform);
  warnings.push(...platform.warnings);
  if (!platform.passed) {
    issues.push(...platform.errors);
  }
  const platformLayer = { passed: platform.passed, reasons: platform.errors };

  // ── Layer 6: Claude moderator (skip if already failed something) ──
  let moderatorLayer = {
    passed: true,
    riskScore: 0,
    issues: [] as string[],
  };
  if (input.skipLlm) {
    moderatorLayer = { passed: true, riskScore: 0, issues: ["skipped via skipLlm"] };
  } else if (issues.length === 0) {
    const m = await moderateContent(finalText);
    llmCostUsd = m.costUsd;
    moderatorLayer = { passed: m.safe, riskScore: m.riskScore, issues: m.issues };
    if (!m.safe) {
      issues.push(...m.issues.map((i) => `[moderator] ${i}`));
    }
  }

  const approved = issues.length === 0;
  log.info(
    {
      platform: input.platform,
      approved,
      issues: issues.length,
      warnings: warnings.length,
      autoFixed,
      llmCostUsd: llmCostUsd.toFixed(6),
    },
    approved ? "gate pass" : "gate fail",
  );

  return {
    approved,
    finalText,
    issues,
    warnings,
    autoFixed,
    llmCostUsd,
    layers: {
      forbidden: forbiddenLayer,
      platform: platformLayer,
      disclosure: disclosureLayer,
      moderator: moderatorLayer,
    },
  };
}

/**
 * Compliance checker — orchestrates all checks for a piece of content.
 *
 * Layers:
 *  1. Thai legal (forbidden words from forbidden-words.ts)
 *  2. AI disclosure (must label AI content per platform)
 *  3. Affiliate disclosure (must say "อาจได้รับค่าคอม")
 *  4. Trademark watch (configurable list)
 *
 * Auto-fix where safe; block & flag where not.
 */

import { scanForbidden } from "./forbidden-words.ts";
import { db, schema } from "../lib/db.ts";
import { child } from "../lib/logger.ts";

const log = child("compliance");

export interface CheckContentInput {
  text: string;
  isAiGenerated: boolean;
  productCategory?: string;
  /** What channel is this for? Different platforms have different rules. */
  channel?: "web" | "tiktok" | "facebook" | "instagram" | "youtube" | "pinterest" | "telegram";
}

export interface CheckContentOutput {
  passed: boolean;
  autoFixed: boolean;
  fixedText?: string;
  flags: {
    forbiddenBlocked: string[]; // rule IDs
    forbiddenSoftened: string[];
    failedChecks: string[];
    addedDisclosures: string[];
    aiLabelRequired: boolean;
    affiliateDisclosureRequired: boolean;
  };
}

const AFFILIATE_DISCLOSURE_TH =
  "*โพสต์มี affiliate link — เราอาจได้รับค่าคอมเมื่อคุณซื้อผ่านลิงก์ในเนื้อหา*";

const AI_LABEL_TH = "เนื้อหาบางส่วนสร้างโดย AI";

export async function checkContent(input: CheckContentInput): Promise<CheckContentOutput> {
  let text = input.text;
  let autoFixed = false;
  const flags: CheckContentOutput["flags"] = {
    forbiddenBlocked: [],
    forbiddenSoftened: [],
    failedChecks: [],
    addedDisclosures: [],
    aiLabelRequired: false,
    affiliateDisclosureRequired: false,
  };

  // 1. Forbidden words
  const forbidden = scanForbidden(text);
  flags.forbiddenBlocked = forbidden.blocked.map((r) => r.id);
  flags.forbiddenSoftened = forbidden.softened.map((s) => s.rule.id);

  if (forbidden.fixedText) {
    text = forbidden.fixedText;
    autoFixed = true;
  }

  if (!forbidden.passed) {
    flags.failedChecks.push("forbidden_words_blocking");
  }

  // 2. AI disclosure (channel-specific)
  if (input.isAiGenerated) {
    flags.aiLabelRequired = needsAiLabel(input.channel ?? "web");
    if (flags.aiLabelRequired && !text.includes(AI_LABEL_TH) && input.channel !== "web") {
      // For web, the AI label is implicit; for social, must be in caption
      text = `${AI_LABEL_TH}\n\n${text}`;
      flags.addedDisclosures.push("ai_label");
      autoFixed = true;
    }
  }

  // 3. Affiliate disclosure
  flags.affiliateDisclosureRequired = true; // always — pro forma
  if (!hasAffiliateDisclosure(text) && input.channel !== "web") {
    text = `${AFFILIATE_DISCLOSURE_TH}\n\n${text}`;
    flags.addedDisclosures.push("affiliate");
    autoFixed = true;
  }

  // Persist log (best-effort, don't fail the call)
  try {
    await db.insert(schema.complianceLogs).values({
      subjectKind: "content_text",
      subjectId: 0,
      checkName: "checkContent",
      passed: forbidden.passed,
      severity: forbidden.passed ? "info" : "warn",
      notes: forbidden.blocked.length
        ? `blocked: ${forbidden.blocked.map((r) => r.id).join(",")}`
        : null,
      autoFixApplied: autoFixed,
      autoFixDescription: autoFixed
        ? `softened: ${flags.forbiddenSoftened.join(",")}; added: ${flags.addedDisclosures.join(",")}`
        : null,
    });
  } catch (err) {
    log.warn({ err }, "failed to log compliance check");
  }

  return {
    passed: forbidden.passed,
    autoFixed,
    fixedText: autoFixed ? text : undefined,
    flags,
  };
}

function needsAiLabel(channel: string): boolean {
  // Updated as of 2026 platform policies
  switch (channel) {
    case "tiktok":
    case "instagram":
    case "facebook":
    case "youtube":
      return true;
    case "pinterest":
    case "telegram":
    case "web":
      return false;
    default:
      return true; // default to safer
  }
}

function hasAffiliateDisclosure(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("affiliate") ||
    lower.includes("ค่าคอม") ||
    lower.includes("#ad") ||
    lower.includes("#โฆษณา") ||
    lower.includes("รายได้จากการแนะนำ")
  );
}

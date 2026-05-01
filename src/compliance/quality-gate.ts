/**
 * Quality gate — final filter before content goes "published" status.
 *
 * Catches patterns that would lower SEO ranking or risk platform penalty:
 *   - AI-fingerprint phrases ("In conclusion,", "It's important to note that...")
 *   - Repetitive sentence structure (3+ sentences starting same way)
 *   - Excessive marketing buzzwords
 *   - Word count outside style window
 *   - Verbatim review copying (must paraphrase)
 *   - Non-product reference (verdict drifted off topic)
 *
 * Returns gate decision + suggested fixes.
 */

export interface QualityGateInput {
  text: string;
  productName: string;
  brand?: string | null;
  reviewSnippets?: string[];
  styleWindow?: { min: number; max: number };
}

export interface QualityGateResult {
  passed: boolean;
  score: number; // 0..100
  issues: Array<{
    code: string;
    severity: "block" | "warn";
    detail: string;
    suggestedFix?: string;
  }>;
}

// Common AI tells in Thai content (translated patterns + literal AI-isms)
const AI_FINGERPRINTS_TH = [
  /\bในยุคปัจจุบัน\b/,
  /\bในโลกที่เปลี่ยนแปลงอย่างรวดเร็ว\b/,
  /\bไม่ว่าจะเป็น.*หรือ.*ก็ตาม\b/,
  /\bสรุปได้ว่า\b/,
  /\bกล่าวโดยสรุป\b/,
  /\bในทางกลับกัน\b/,
  /\bน่าสนใจอย่างยิ่ง\b/,
  /\bดียอดเยี่ยม\b/,
  /\bน่าประทับใจอย่างมาก\b/,
];

const AI_FINGERPRINTS_EN = [
  /\bIn conclusion\b/i,
  /\bIt's important to note\b/i,
  /\bIn today's fast-paced world\b/i,
  /\bIn the realm of\b/i,
  /\bdelve into\b/i,
  /\bnavigate the\b/i,
  /\btapestry of\b/i,
];

const BUZZWORDS = [
  /\bปฏิวัติวงการ\b/,
  /\bเปลี่ยนแปลงชีวิต\b/,
  /\bไม่เคยมีใครทำได้\b/,
  /\bเหนือชั้น\b/,
  /\bเกินคำบรรยาย\b/,
];

export function checkQualityGate(input: QualityGateInput): QualityGateResult {
  const issues: QualityGateResult["issues"] = [];
  const text = input.text.trim();
  const window = input.styleWindow ?? { min: 50, max: 100 };

  // 1. Word count check (Thai approx — count whitespace-separated tokens + Thai segments)
  const approxWords = countThaiWordsApprox(text);
  if (approxWords < window.min) {
    issues.push({
      code: "too-short",
      severity: "warn",
      detail: `${approxWords} words < ${window.min} target`,
      suggestedFix: "Expand verdict slightly with one more concrete fact",
    });
  } else if (approxWords > window.max + 30) {
    issues.push({
      code: "too-long",
      severity: "warn",
      detail: `${approxWords} words > ${window.max + 30}`,
      suggestedFix: "Trim to focus on top 2 pros and 1 con",
    });
  }

  // 2. AI fingerprint phrases
  for (const re of AI_FINGERPRINTS_TH) {
    if (re.test(text)) {
      issues.push({
        code: "ai-fingerprint-th",
        severity: "block",
        detail: `matched: ${re.source}`,
      });
    }
  }
  for (const re of AI_FINGERPRINTS_EN) {
    if (re.test(text)) {
      issues.push({
        code: "ai-fingerprint-en",
        severity: "block",
        detail: `matched: ${re.source}`,
      });
    }
  }

  // 3. Buzzwords
  for (const re of BUZZWORDS) {
    if (re.test(text)) {
      issues.push({
        code: "marketing-buzzword",
        severity: "warn",
        detail: `matched: ${re.source}`,
        suggestedFix: "Replace with concrete description",
      });
    }
  }

  // 4. Repetitive sentence openers
  const sentences = text.split(/[.!?。]+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length >= 3) {
    const openers = sentences.map((s) => s.split(/\s+/).slice(0, 2).join(" "));
    const counts = new Map<string, number>();
    for (const o of openers) counts.set(o, (counts.get(o) ?? 0) + 1);
    for (const [opener, count] of counts) {
      if (count >= 3) {
        issues.push({
          code: "repetitive-opener",
          severity: "warn",
          detail: `"${opener}" used ${count}x`,
          suggestedFix: "Vary sentence openings",
        });
      }
    }
  }

  // 5. Verbatim review copy detection
  if (input.reviewSnippets && input.reviewSnippets.length > 0) {
    for (const review of input.reviewSnippets) {
      const reviewSnippet = review.slice(0, 60);
      if (reviewSnippet.length >= 30 && text.includes(reviewSnippet)) {
        issues.push({
          code: "verbatim-review",
          severity: "block",
          detail: `verbatim copy of review: "${reviewSnippet}..."`,
          suggestedFix: "Paraphrase rather than quote directly",
        });
      }
    }
  }

  // 6. Product mention check (verdict must reference the product)
  const nameTokens = input.productName.toLowerCase().split(/\s+/).filter((t) => t.length >= 3);
  const lowerText = text.toLowerCase();
  const mentioned = nameTokens.some((t) => lowerText.includes(t));
  const brandMentioned = input.brand
    ? lowerText.includes(input.brand.toLowerCase())
    : false;
  if (!mentioned && !brandMentioned) {
    issues.push({
      code: "off-topic",
      severity: "block",
      detail: "verdict does not reference product name or brand",
    });
  }

  // 7. Score
  const blocks = issues.filter((i) => i.severity === "block").length;
  const warns = issues.filter((i) => i.severity === "warn").length;
  const score = Math.max(0, 100 - blocks * 30 - warns * 8);

  return {
    passed: blocks === 0,
    score,
    issues,
  };
}

/**
 * Approximate Thai word count.
 * Thai has no spaces between words, so we estimate via syllable boundaries:
 *  - count tone marks + initial-consonant patterns
 *  - + Latin word splits
 */
export function countThaiWordsApprox(text: string): number {
  const latin = text.match(/[a-zA-Z0-9]+/g) ?? [];
  // Thai char count ÷ 4 (avg word length in chars for Thai)
  const thaiChars = (text.match(/[฀-๿]/g) ?? []).length;
  const thaiWords = Math.ceil(thaiChars / 4);
  return latin.length + thaiWords;
}

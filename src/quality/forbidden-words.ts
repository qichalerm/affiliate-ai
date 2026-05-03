/**
 * Forbidden words/phrases — fast deterministic filter.
 *
 * Catches the obvious + common violations BEFORE making an LLM call.
 * Saves ~$0.001 per content piece by short-circuiting on clear violations.
 *
 * Categories:
 *   medical   — health/cure claims (Thai FDA + global ad standards)
 *   financial — get-rich/loan/investment schemes
 *   legal     — illegal goods/services
 *   adult     — explicit content
 *   politics  — divisive political content (brand safety)
 *
 * Returns matched terms so callers can log/alert. Empty array = passed.
 */

interface ForbiddenRule {
  pattern: RegExp;
  category: "medical" | "financial" | "legal" | "adult" | "politics" | "religion";
  severity: "block" | "warn"; // block = fail gate; warn = log but allow
  reason: string;
}

const RULES: ForbiddenRule[] = [
  // === Medical claims (Thai FDA forbidden) ===
  { pattern: /รักษา.{0,10}(มะเร็ง|เบาหวาน|ความดัน|hiv|aids|โรคหัวใจ)/i, category: "medical", severity: "block", reason: "claims to treat serious illness" },
  { pattern: /ลดน้ำหนัก.{0,10}(ใน|ภายใน)\s*\d+\s*(วัน|สัปดาห์)/i, category: "medical", severity: "block", reason: "weight-loss time guarantee" },
  { pattern: /(ขาว|ผิวขาว).{0,10}ใน\s*\d+\s*(วัน|สัปดาห์)/i, category: "medical", severity: "block", reason: "skin whitening time guarantee" },
  { pattern: /(หย่อน|กระชับ).{0,15}(ทันที|ภายใน)/i, category: "medical", severity: "warn", reason: "anti-aging instant claim" },
  { pattern: /แพทย์.{0,10}(แนะนำ|รับรอง)/i, category: "medical", severity: "warn", reason: "unverified medical endorsement" },
  { pattern: /อย\.\s*(ประกัน|รับรอง)/i, category: "medical", severity: "warn", reason: "FDA endorsement claim" },
  { pattern: /\b(cure|heal|treats?)\s+(cancer|diabetes|hiv|covid)/i, category: "medical", severity: "block", reason: "EN: cure claim" },

  // === Financial / pyramid schemes ===
  { pattern: /(รวย|เศรษฐี).{0,15}(เร็ว|ใน\s*\d+|ภายใน)/i, category: "financial", severity: "block", reason: "get-rich-quick" },
  { pattern: /ผลตอบแทน.{0,10}\d+\s*(%|เปอร์เซ็นต์)/i, category: "financial", severity: "warn", reason: "guaranteed return %" },
  { pattern: /กู้เงิน.{0,10}(ด่วน|ทันที|ไม่เช็ค)/i, category: "financial", severity: "block", reason: "predatory loan" },
  { pattern: /ดอกเบี้ย.{0,10}\d+\s*%.{0,5}ต่อวัน/i, category: "financial", severity: "block", reason: "loan-shark interest" },
  { pattern: /(get rich|make money fast|guaranteed returns)/i, category: "financial", severity: "block", reason: "EN: scam pattern" },

  // === Legal / illegal goods ===
  { pattern: /(กัญชา|ยาบ้า|ยาอี|cocaine|ecstasy|cannabis)/i, category: "legal", severity: "block", reason: "illegal drugs" },
  { pattern: /(ปืน|อาวุธปืน|อาวุธทำเอง)/i, category: "legal", severity: "block", reason: "weapons" },
  { pattern: /พนัน.{0,15}(ออนไลน์|ฟรี)/i, category: "legal", severity: "block", reason: "gambling promotion" },
  { pattern: /(บุหรี่ไฟฟ้า|น้ำยาบุหรี่)/i, category: "legal", severity: "warn", reason: "vape (regulated in TH)" },

  // === Adult ===
  { pattern: /(porn|xxx|เซ็กซ์ทอย|sex toy)/i, category: "adult", severity: "block", reason: "adult content" },

  // === Politics (brand safety — Thai context) ===
  { pattern: /(ทักษิณ|ประยุทธ์|พิธา|เพื่อไทย|ก้าวไกล|ประชาธิปัตย์)/i, category: "politics", severity: "block", reason: "Thai politician/party name" },
  { pattern: /(เสื้อแดง|เสื้อเหลือง|112|ม\.\s*112)/i, category: "politics", severity: "block", reason: "Thai political symbol" },
  { pattern: /(rally|protest|coup|military regime)/i, category: "politics", severity: "warn", reason: "EN: political event" },

  // === Religion (avoid sensitive topics) ===
  { pattern: /(พุทธ|คริสต์|อิสลาม|ฮินดู).{0,15}(ดีกว่า|ผิด|ถูก)/i, category: "religion", severity: "block", reason: "religious comparison" },
];

export interface ForbiddenScanResult {
  passed: boolean;
  blocked: string[];   // human-readable reason for each blocked match
  warnings: string[];  // human-readable reason for each warning match
  matchedTerms: string[]; // actual matched substrings (for logging)
}

/**
 * Scan text for forbidden patterns.
 *
 * Returns:
 *   passed=true   if no `severity:block` matches (warnings still allowed through)
 *   passed=false  if any block-level rule matched
 */
export function scanForbidden(text: string): ForbiddenScanResult {
  const blocked: string[] = [];
  const warnings: string[] = [];
  const matchedTerms: string[] = [];

  for (const rule of RULES) {
    const m = text.match(rule.pattern);
    if (!m) continue;
    matchedTerms.push(m[0]);
    if (rule.severity === "block") {
      blocked.push(`[${rule.category}] ${rule.reason}: "${m[0]}"`);
    } else {
      warnings.push(`[${rule.category}] ${rule.reason}: "${m[0]}"`);
    }
  }

  return {
    passed: blocked.length === 0,
    blocked,
    warnings,
    matchedTerms,
  };
}

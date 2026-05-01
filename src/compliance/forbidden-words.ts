/**
 * Forbidden / regulated words for Thai marketing.
 * Sources:
 *  - พรบ.อาหารและยา (อย.) — health claims
 *  - พรบ.คุ้มครองผู้บริโภค (สคบ.) — superlative / misleading
 *  - Shopee TOS — fake reviews, manipulation
 *  - พรบ.โฆษณาเครื่องสำอาง — beauty claims
 *
 * Each entry:
 *   { pattern: regex, replacement: alt phrasing, severity }
 *
 * "block" = reject content / require human review
 * "soften" = auto-replace with neutral phrasing
 */

export interface ForbiddenRule {
  id: string;
  pattern: RegExp;
  category: "medical" | "superlative" | "guarantee" | "manipulation" | "beauty";
  severity: "block" | "soften";
  replacement?: string;
  reason: string;
}

export const FORBIDDEN_RULES: ForbiddenRule[] = [
  // === Medical / health claims (อย.) ===
  {
    id: "med.cure",
    pattern: /\bรักษา(?:โรค|อาการ)?(?:ได้)?\b/g,
    category: "medical",
    severity: "block",
    reason: "อ้างสรรพคุณรักษาโรค ผิด พรบ.อาหารและยา",
  },
  {
    id: "med.heal",
    pattern: /\b(?:หายขาด|ทำให้หาย|รักษาหาย)\b/g,
    category: "medical",
    severity: "block",
    reason: "อ้างสรรพคุณการรักษา",
  },
  {
    id: "med.cure-disease",
    pattern: /\b(?:มะเร็ง|เบาหวาน|ความดัน|หัวใจ|อัมพาต)\b.{0,40}(?:หาย|รักษา)/g,
    category: "medical",
    severity: "block",
    reason: "อ้างรักษาโรคเฉพาะ",
  },
  {
    id: "med.safe-100",
    pattern: /\bปลอดภัย\s*100\s*%/g,
    category: "medical",
    severity: "block",
    reason: "ห้ามอ้างความปลอดภัยสมบูรณ์",
  },
  {
    id: "med.no-side-effect",
    pattern: /\b(?:ไม่มี|ปราศจาก)\s*ผลข้างเคียง/g,
    category: "medical",
    severity: "block",
    reason: "ห้ามอ้างไม่มีผลข้างเคียง",
  },

  // === Superlatives / unsubstantiated claims (สคบ.) ===
  {
    id: "super.best",
    pattern: /\b(?:ดีที่สุด|ดีที่สุดในโลก|ดีที่สุดในประเทศ)\b/g,
    category: "superlative",
    severity: "soften",
    replacement: "เป็นที่นิยม",
    reason: "ซูเปอร์ลทีฟไม่มีหลักฐาน",
  },
  {
    id: "super.first",
    pattern: /\b(?:อันดับ\s*1|อันดับหนึ่ง|เบอร์\s*1|เบอร์หนึ่ง)\b/g,
    category: "superlative",
    severity: "soften",
    replacement: "ขายดี",
    reason: "อ้างอันดับโดยไม่มีแหล่ง",
  },
  {
    id: "super.unique",
    pattern: /\b(?:หนึ่งเดียว|มีที่นี่ที่เดียว|ที่ดีที่สุด)\b/g,
    category: "superlative",
    severity: "soften",
    replacement: "เด่นที่",
    reason: "อ้าง exclusivity เกินจริง",
  },
  {
    id: "super.miracle",
    pattern: /\b(?:มหัศจรรย์|ปาฏิหาริย์|พลิกชีวิต)\b/g,
    category: "superlative",
    severity: "soften",
    replacement: "น่าสนใจ",
    reason: "เกินจริง",
  },

  // === Guarantees ===
  {
    id: "guar.satisfaction",
    pattern: /\b(?:รับประกันความพึงพอใจ|การันตี\s*100\s*%)\b/g,
    category: "guarantee",
    severity: "soften",
    replacement: "มีการรับประกันตามเงื่อนไข",
    reason: "การันตีไม่มีเงื่อนไขชัดเจน",
  },
  {
    id: "guar.refund",
    pattern: /\bคืนเงิน\s*100\s*%(?!\s*(?:ภายใน|ตาม))/g,
    category: "guarantee",
    severity: "soften",
    replacement: "คืนเงินตามเงื่อนไข",
    reason: "เงื่อนไขคืนเงินไม่ชัด",
  },

  // === Beauty claims (cosmetics) ===
  {
    id: "beauty.whitening",
    pattern: /\b(?:ขาวขึ้น|ขาวใส|ผิวขาว)\s*(?:แน่นอน|ทันที|ภายใน\s*\d+\s*วัน)/g,
    category: "beauty",
    severity: "soften",
    replacement: "ช่วยดูแลผิว",
    reason: "อ้างผลทันที/แน่นอน ผิด พรบ.เครื่องสำอาง",
  },
  {
    id: "beauty.anti-aging",
    pattern: /\b(?:ย้อนวัย|หยุดเวลา|กลับเป็นวัยรุ่น)/g,
    category: "beauty",
    severity: "soften",
    replacement: "ลดเลือนริ้วรอย",
    reason: "อ้าง anti-aging เกินจริง",
  },

  // === Manipulation / fake (Shopee TOS + พรบ.คอมพิวเตอร์) ===
  {
    id: "manip.fake-review",
    pattern: /\b(?:รีวิวจริง|รีวิวจาก\s*ตัวจริง|ผู้ใช้จริงรีวิว)\b/g,
    category: "manipulation",
    severity: "soften",
    replacement: "ตามรีวิวที่รวบรวมมา",
    reason: "อ้างความจริงของรีวิวต้องระวัง",
  },
];

export interface ScanResult {
  passed: boolean;
  blocked: ForbiddenRule[];
  softened: { rule: ForbiddenRule; original: string }[];
  fixedText?: string;
}

/**
 * Scan a piece of text against forbidden rules.
 * - "block" rules → return passed=false (require human review)
 * - "soften" rules → auto-replace, return passed=true with fixedText
 */
export function scanForbidden(text: string): ScanResult {
  const blocked: ForbiddenRule[] = [];
  const softened: ScanResult["softened"] = [];
  let fixed = text;

  for (const rule of FORBIDDEN_RULES) {
    if (rule.severity === "block") {
      const match = text.match(rule.pattern);
      if (match) blocked.push(rule);
    } else if (rule.severity === "soften") {
      const matches = fixed.match(rule.pattern);
      if (matches) {
        for (const m of matches) {
          softened.push({ rule, original: m });
        }
        fixed = fixed.replace(rule.pattern, rule.replacement ?? "");
      }
    }
  }

  return {
    passed: blocked.length === 0,
    blocked,
    softened,
    fixedText: softened.length > 0 ? fixed : undefined,
  };
}

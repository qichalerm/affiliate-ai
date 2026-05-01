/**
 * Verdict style variants — prevent every page from sounding identical.
 *
 * Google's AI-content classifier picks up "templated repetition" easily.
 * Vary 6 things across pages:
 *   1. Voice/persona
 *   2. Sentence opening pattern
 *   3. Pros/cons framing
 *   4. CTA phrasing
 *   5. Audience targeting verb
 *   6. Verdict length (within 60-90 word band)
 *
 * Style is deterministic per product (hashed slug) — same product always gets same style,
 * but across the catalog you get even distribution.
 */

import type { VerdictInput } from "./verdict.ts";

export interface VerdictStyle {
  id: string;
  systemSuffix: string;
  promptPrefix: string;
  /** Target word count window (Thai). */
  targetWords: { min: number; max: number };
}

export const STYLES: VerdictStyle[] = [
  {
    id: "buyers-friend",
    systemSuffix: `
[STYLE: เพื่อนผู้ซื้อ]
- เปิดด้วย "ถ้าคุณ..." หรือ "สำหรับคน..."
- ใส่ตัวอย่างการใช้งานจริง 1 บรรทัด
- จบด้วย "เหมาะกับ X / ข้ามไปก่อนถ้า Y"`,
    promptPrefix: "เขียน verdict สไตล์เพื่อนแนะนำเพื่อน",
    targetWords: { min: 60, max: 80 },
  },
  {
    id: "spec-focused",
    systemSuffix: `
[STYLE: เน้นสเปก]
- เปิดด้วย "จุดเด่นของ {brand} คือ..."
- อ้างสเปกตัวเลขจริงจากข้อมูล
- จบด้วย trade-off ของราคาเทียบสเปก`,
    promptPrefix: "เขียน verdict เน้นสเปก คนที่อ่านเทคนิคเป็น",
    targetWords: { min: 70, max: 90 },
  },
  {
    id: "review-driven",
    systemSuffix: `
[STYLE: อิงรีวิว]
- เปิดด้วย "จากผู้ใช้จริง..." / "ผู้ซื้อพูดถึง..."
- อ้างรีวิวเฉพาะจุดที่ซ้ำกันหลายคน
- ชี้ pattern ทั้งบวกและลบ`,
    promptPrefix: "เขียน verdict สังเคราะห์จากรีวิวของผู้ซื้อจริง",
    targetWords: { min: 65, max: 85 },
  },
  {
    id: "use-case",
    systemSuffix: `
[STYLE: ตามการใช้งาน]
- เปิดด้วยสถานการณ์: "ถ้าใช้สำหรับ X..." / "เหมาะตอน..."
- ระบุ persona เป้าหมายชัด
- จบด้วยข้อจำกัดของการใช้งาน`,
    promptPrefix: "เขียน verdict โดย frame ตามสถานการณ์การใช้งาน",
    targetWords: { min: 60, max: 80 },
  },
  {
    id: "value-focused",
    systemSuffix: `
[STYLE: คุ้มค่าต่อราคา]
- เปิดด้วย "ที่ราคา X บาท..."
- เปรียบเทียบ implicit กับ tier ที่ต่ำ/สูงกว่า
- ปิดด้วย "เหมาะถ้าคุณยอมแลก X เพื่อ Y"`,
    promptPrefix: "เขียน verdict โดยเน้นมุมความคุ้มค่าต่อราคา",
    targetWords: { min: 65, max: 85 },
  },
  {
    id: "concise",
    systemSuffix: `
[STYLE: สั้น กระชับ]
- เริ่มด้วย verb ทันที ไม่มี intro
- ประโยคสั้น เน้นใจความ
- ไม่ใช้คำเชื่อมเยอะ`,
    promptPrefix: "เขียน verdict สั้น กระชับ สำหรับคนรีบ",
    targetWords: { min: 50, max: 70 },
  },
];

/** Hash slug → consistent style id. */
function hashStyle(slug: string): VerdictStyle {
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = (h * 31 + slug.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % STYLES.length;
  return STYLES[idx]!;
}

export function pickStyleForSlug(slug: string): VerdictStyle {
  return hashStyle(slug);
}

/**
 * Apply a style to a base verdict prompt.
 */
export function applyStyleToVerdictPrompt(
  basePrompt: string,
  baseSystem: string,
  style: VerdictStyle,
): { prompt: string; system: string } {
  return {
    system: `${baseSystem}\n${style.systemSuffix}`,
    prompt: `${style.promptPrefix}\n\n${basePrompt}`,
  };
}

/**
 * Shopee marketplace has many similar products — give variation hints
 * to avoid the LLM repeating itself across "wireless earbuds X" / "wireless earbuds Y".
 */
export function variationHint(input: Pick<VerdictInput, "productName">): string {
  // Random variation to keep LLM outputs less templated
  const opens = [
    "เริ่มย่อหน้าด้วยข้อมูลจริง อย่าเริ่มด้วยคำชม",
    "ห้ามขึ้นต้นด้วย 'นี่คือ' หรือ 'ยินดี'",
    "อย่าใช้รูปแบบ 'ข้อดี: ... ข้อเสีย: ...'",
    "หลีกเลี่ยงคำว่า 'น่าประทับใจ' 'น่าสนใจ' 'น่าตื่นเต้น'",
    "อย่าจบประโยคสุดท้ายด้วยคำว่า 'แน่นอน'",
  ];
  const idx = Math.floor(Math.random() * opens.length);
  return opens[idx]!;
}

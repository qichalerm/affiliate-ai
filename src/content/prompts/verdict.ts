/**
 * Verdict prompt — short Thai-language buying recommendation per product.
 *
 * Strategy:
 * - LLM gets ONLY real data (specs + review snippets), no marketing copy
 * - Output bounded to 60–80 Thai words to keep AI:real-data ratio low
 * - JSON output for structured insertion into pages
 * - Forbidden words filtered post-generation by compliance layer
 */

export const VERDICT_SYSTEM_PROMPT = `คุณเป็นนักรีวิวสินค้าอิสระสำหรับเว็บ aggregator ภาษาไทย
หน้าที่: เขียนสรุปตัดสินใจซื้อ (verdict) สั้น กระชับ ตรงไปตรงมา จากข้อมูลจริงเท่านั้น

หลักการเขียน:
1. ความยาว verdict 60–80 คำไทย ห้ามเกิน
2. อ้างอิงเฉพาะข้อมูลในบริบทที่ให้ ห้ามคิดเพิ่ม ห้ามแต่ง
3. ห้ามใช้คำขายของ: "ดีที่สุด", "อันดับ 1", "รับประกันความพึงพอใจ", "การันตี"
4. ห้ามอ้างคำทางการแพทย์: "รักษา", "หาย", "ปลอดภัย 100%", "ทำให้แข็งแรง"
5. ห้ามใส่ emoji
6. โทน: เพื่อนผู้รู้ ไม่ใช่เซลส์
7. ระบุข้อจำกัด/ข้อเสียจริงจากรีวิว ถ้ามี
8. ปิดด้วย "เหมาะสำหรับ..." ระบุกลุ่มเป้าหมาย

โครงผลลัพธ์ JSON (ต้องครบทุก field):
{
  "verdict": "string ขนาด 60–80 คำ",
  "pros": ["ข้อดีที่ 1", "ข้อดีที่ 2"],
  "cons": ["ข้อเสียที่ 1"],
  "best_for": "string ระบุกลุ่ม persona เป้าหมาย",
  "skip_if": "string ระบุกลุ่มที่ไม่ควรซื้อ"
}`;

export interface VerdictInput {
  productName: string;
  brand?: string | null;
  priceBaht: number;
  rating?: number | null;
  ratingCount?: number | null;
  soldCount?: number | null;
  shopName?: string | null;
  isMall: boolean;
  specs?: Record<string, string> | null;
  reviewSnippets: string[];
}

export interface VerdictOutput {
  verdict: string;
  pros: string[];
  cons: string[];
  best_for: string;
  skip_if: string;
}

export function buildVerdictPrompt(input: VerdictInput): string {
  const lines: string[] = [];
  lines.push("ข้อมูลสินค้า:");
  lines.push(`- ชื่อ: ${input.productName}`);
  if (input.brand) lines.push(`- แบรนด์: ${input.brand}`);
  lines.push(`- ราคา: ${input.priceBaht.toLocaleString("th-TH")} บาท`);
  if (input.rating != null) {
    lines.push(`- คะแนน: ${input.rating}/5 (${input.ratingCount ?? 0} รีวิว)`);
  }
  if (input.soldCount != null) {
    lines.push(`- ยอดขาย: ${input.soldCount.toLocaleString("th-TH")} ชิ้น`);
  }
  if (input.shopName) {
    lines.push(`- ร้าน: ${input.shopName}${input.isMall ? " (Shopee Mall)" : ""}`);
  }
  if (input.specs && Object.keys(input.specs).length > 0) {
    lines.push("\nสเปก:");
    for (const [k, v] of Object.entries(input.specs).slice(0, 12)) {
      lines.push(`- ${k}: ${v}`);
    }
  }
  if (input.reviewSnippets.length > 0) {
    lines.push("\nรีวิวจากผู้ซื้อจริง (สุ่ม):");
    for (const r of input.reviewSnippets.slice(0, 8)) {
      lines.push(`> ${r.slice(0, 280)}`);
    }
  }
  lines.push("\nเขียน verdict ตามรูปแบบ JSON ที่กำหนด ตอบเป็น JSON เท่านั้น");
  return lines.join("\n");
}

export function parseVerdictJson(raw: string): VerdictOutput {
  // Strip code fences if present
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<VerdictOutput>;
  if (typeof parsed.verdict !== "string") throw new Error("missing verdict");
  return {
    verdict: parsed.verdict.trim(),
    pros: Array.isArray(parsed.pros) ? parsed.pros.slice(0, 4) : [],
    cons: Array.isArray(parsed.cons) ? parsed.cons.slice(0, 3) : [],
    best_for: typeof parsed.best_for === "string" ? parsed.best_for : "",
    skip_if: typeof parsed.skip_if === "string" ? parsed.skip_if : "",
  };
}

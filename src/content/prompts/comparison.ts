/**
 * A vs B comparison prompt.
 * Used for /เปรียบเทียบ/{a}-vs-{b} pages — high CVR template.
 */

export const COMPARISON_SYSTEM_PROMPT = `คุณเขียนบทความ "A vs B" ภาษาไทยแบบเป็นกลาง อิงข้อมูลจริงเท่านั้น
หลักการ:
1. ห้ามตัดสินว่า "ตัวไหนดีกว่า" แบบรวมๆ — ให้ตัดสินตามความต้องการ persona
2. ระบุ trade-off แต่ละด้านอย่างชัดเจน
3. ห้ามคำขายของ ห้าม emoji
4. ปิดด้วย "ใครควรเลือก A / ใครควรเลือก B"
5. โทนเป็นกลาง ไม่ลำเอียง

โครงผลลัพธ์ JSON:
{
  "intro": "string 50–80 คำ บอกว่าเปรียบเทียบ 2 ตัวนี้เพราะอะไร",
  "differences": [
    { "aspect": "ด้าน X", "winner": "a" | "b" | "tie", "note": "เหตุผลสั้น" }
  ],
  "best_for_a": "ใครควรเลือก A",
  "best_for_b": "ใครควรเลือก B",
  "verdict": "string 40–60 คำ สรุปว่าตัดสินยังไง"
}`;

export interface ComparisonInput {
  productA: { name: string; priceBaht: number; rating?: number | null; specs?: Record<string, string> | null };
  productB: { name: string; priceBaht: number; rating?: number | null; specs?: Record<string, string> | null };
}

export interface ComparisonOutput {
  intro: string;
  differences: Array<{ aspect: string; winner: "a" | "b" | "tie"; note: string }>;
  best_for_a: string;
  best_for_b: string;
  verdict: string;
}

export function buildComparisonPrompt(input: ComparisonInput): string {
  const fmt = (p: ComparisonInput["productA"], label: "A" | "B") => {
    const lines = [`${label}: ${p.name}`, `   ราคา: ${p.priceBaht.toLocaleString("th-TH")} บาท`];
    if (p.rating != null) lines.push(`   คะแนน: ${p.rating}/5`);
    if (p.specs) {
      for (const [k, v] of Object.entries(p.specs).slice(0, 8)) {
        lines.push(`   - ${k}: ${v}`);
      }
    }
    return lines.join("\n");
  };

  return `ข้อมูล:\n${fmt(input.productA, "A")}\n\n${fmt(input.productB, "B")}\n\nเขียนเปรียบเทียบเป็น JSON ตามแบบที่กำหนด`;
}

export function parseComparisonJson(raw: string): ComparisonOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<ComparisonOutput>;
  return {
    intro: parsed.intro ?? "",
    differences: Array.isArray(parsed.differences)
      ? parsed.differences.slice(0, 8).filter(
          (d): d is ComparisonOutput["differences"][number] =>
            !!d &&
            typeof d.aspect === "string" &&
            (d.winner === "a" || d.winner === "b" || d.winner === "tie") &&
            typeof d.note === "string",
        )
      : [],
    best_for_a: parsed.best_for_a ?? "",
    best_for_b: parsed.best_for_b ?? "",
    verdict: parsed.verdict ?? "",
  };
}

/**
 * FAQ generator prompt — produces 4-6 question/answer pairs per product.
 *
 * Why FAQs matter for SEO/AI:
 *  - Google's AI Overview cites pages with structured FAQs
 *  - FAQPage schema generates rich snippet expandable in SERP
 *  - Long-tail keyword capture (people search "ราคาเท่าไร", "ดีไหม", "เหมาะกับใคร")
 *  - Increases dwell time + pages-per-visit
 *
 * Strategy:
 *  - 4-6 FAQs per page
 *  - Mix of: factual (price, specs), comparative (vs alternatives), practical (use cases)
 *  - Answers grounded in real data (price, rating, reviews) + brief
 *  - Skip generic questions ("คืออะไร", "ใช้งานยังไง" without specifics)
 */

import type { Product } from "../../db/schema.ts";
import { bahtFromSatang } from "../../lib/format.ts";

export const FAQ_SYSTEM_PROMPT = `คุณสร้าง FAQ ภาษาไทยสำหรับหน้ารีวิวสินค้า
ข้อกำหนด:
1. สร้าง 4-6 คู่ question/answer
2. คำถามต้องเป็นคำถามจริงที่คนค้นหาใน Google (long-tail SEO)
3. คำตอบ 30-80 คำ ต่อคำถาม กระชับ ชัดเจน
4. อ้างข้อมูลจริงในบริบท (ราคา, สเปก, รีวิว) ไม่แต่ง
5. หลีกเลี่ยงคำถามทั่วๆ ไป ("คืออะไร", "ดีไหม") — เน้นเฉพาะ
6. ครอบคลุม:
   - ราคา/ความคุ้ม (1 ข้อ)
   - การใช้งานเฉพาะ (1-2 ข้อ)
   - เปรียบเทียบกับทางเลือก (1 ข้อ)
   - ข้อจำกัด/ข้อเสีย (1 ข้อ)
   - สเปก/ความเข้ากันได้ (0-1 ข้อ)
7. ห้าม emoji ห้ามคำเกินจริง

JSON output:
{
  "faqs": [
    { "question": "...", "answer": "..." },
    ...
  ]
}`;

export interface FaqInput {
  productName: string;
  brand?: string | null;
  priceBaht: number;
  rating?: number | null;
  ratingCount?: number | null;
  soldCount?: number | null;
  specs?: Record<string, string> | null;
  reviewSnippets: string[];
  category?: string;
}

export interface FaqOutput {
  faqs: Array<{ question: string; answer: string }>;
}

export function buildFaqPrompt(input: FaqInput): string {
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
  if (input.category) lines.push(`- หมวด: ${input.category}`);
  if (input.specs && Object.keys(input.specs).length > 0) {
    lines.push("\nสเปก:");
    for (const [k, v] of Object.entries(input.specs).slice(0, 10)) {
      lines.push(`- ${k}: ${v}`);
    }
  }
  if (input.reviewSnippets.length > 0) {
    lines.push("\nรีวิวจากผู้ซื้อจริง (สุ่ม):");
    for (const r of input.reviewSnippets.slice(0, 6)) {
      lines.push(`> ${r.slice(0, 220)}`);
    }
  }
  lines.push("\nสร้าง FAQ 4-6 ข้อ ตอบ JSON ตามรูปแบบ");
  return lines.join("\n");
}

export function parseFaqJson(raw: string): FaqOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<FaqOutput>;
  if (!Array.isArray(parsed.faqs)) return { faqs: [] };
  return {
    faqs: parsed.faqs
      .filter(
        (f): f is { question: string; answer: string } =>
          !!f && typeof f.question === "string" && typeof f.answer === "string",
      )
      .slice(0, 8)
      .map((f) => ({
        question: f.question.trim().slice(0, 200),
        answer: f.answer.trim().slice(0, 600),
      })),
  };
}

/**
 * Helper to build FAQ input from Product row.
 */
export function faqInputFromProduct(
  product: Product,
  reviewSnippets: string[],
  categoryName?: string,
): FaqInput {
  return {
    productName: product.name,
    brand: product.brand,
    priceBaht: bahtFromSatang(product.currentPrice ?? 0),
    rating: product.rating,
    ratingCount: product.ratingCount,
    soldCount: product.soldCount,
    specs: product.specifications as Record<string, string> | null,
    reviewSnippets,
    category: categoryName,
  };
}

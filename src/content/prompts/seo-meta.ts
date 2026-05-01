/**
 * SEO metadata generator — title, meta description, h1.
 * Optimized for Thai search intent.
 */

export const SEO_META_SYSTEM = `คุณเขียน SEO metadata ภาษาไทยสำหรับหน้ารีวิวสินค้า
ข้อกำหนด:
- title: 45–60 ตัวอักษรไทย/อังกฤษผสม จบด้วยปี
- meta_description: 130–155 ตัวอักษร โน้มน้าวคลิกแต่ไม่หลอก
- h1: ใกล้เคียง title แต่อาจสั้นกว่า
- ห้ามใส่คำเกินจริง: "ดีที่สุด", "อันดับ 1"
- ใส่ keyword หลักในตำแหน่งหน้า

JSON output:
{
  "title": "...",
  "meta_description": "...",
  "h1": "...",
  "primary_keyword": "...",
  "secondary_keywords": ["...", "..."]
}`;

export interface SeoMetaInput {
  productName: string;
  brand?: string | null;
  pageType: "review" | "comparison" | "best_of";
  year: number;
  comparisonOther?: string;
}

export interface SeoMetaOutput {
  title: string;
  meta_description: string;
  h1: string;
  primary_keyword: string;
  secondary_keywords: string[];
}

export function buildSeoMetaPrompt(input: SeoMetaInput): string {
  if (input.pageType === "comparison") {
    return `เขียน SEO metadata สำหรับหน้า "เปรียบเทียบ ${input.productName} vs ${input.comparisonOther}" ปี ${input.year}\nตอบ JSON ตามรูปแบบที่กำหนด`;
  }
  if (input.pageType === "best_of") {
    return `เขียน SEO metadata สำหรับหน้า "Best of ${input.productName}" ปี ${input.year}\nตอบ JSON ตามรูปแบบที่กำหนด`;
  }
  const subject = input.brand ? `${input.brand} ${input.productName}` : input.productName;
  return `เขียน SEO metadata สำหรับหน้ารีวิว "${subject}" ปี ${input.year}\nตอบ JSON ตามรูปแบบที่กำหนด`;
}

export function parseSeoMetaJson(raw: string): SeoMetaOutput {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned) as Partial<SeoMetaOutput>;
  return {
    title: parsed.title ?? "",
    meta_description: parsed.meta_description ?? "",
    h1: parsed.h1 ?? parsed.title ?? "",
    primary_keyword: parsed.primary_keyword ?? "",
    secondary_keywords: Array.isArray(parsed.secondary_keywords)
      ? parsed.secondary_keywords.slice(0, 8)
      : [],
  };
}

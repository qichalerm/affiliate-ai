/**
 * Multi-niche keyword catalog (V2 Sprint 2).
 *
 * Thai market focus. Each niche has 6-12 trending keywords.
 * AI brain (Sprint 9+) will rotate scrape budget across niches based on
 * which ones produce the highest converting clicks.
 *
 * Cold-start strategy: explore ALL niches equally for first 7-14 days,
 * then auto-shift budget toward winners.
 */

import type { schema } from "../lib/db.ts";

type Niche = (typeof schema.nicheEnum.enumValues)[number];

export const NICHE_KEYWORDS: Record<Niche, string[]> = {
  it_gadget: [
    "หูฟังบลูทูธ",
    "เมาส์ gaming",
    "คีย์บอร์ด mechanical",
    "powerbank",
    "เคสมือถือ",
    "สายชาร์จ Type C",
    "ลำโพงบลูทูธ",
    "หน้าจอ monitor",
    "smart watch",
    "tws earbuds",
    "ที่ชาร์จเร็ว",
    "ขาตั้งโน๊ตบุ๊ค",
  ],
  beauty: [
    "เซรั่ม",
    "ครีมกันแดด",
    "ลิปสติก",
    "มาส์กหน้า",
    "โฟมล้างหน้า",
    "บำรุงผิว",
    "ครีมบำรุง",
    "วิตามินผิว",
    "น้ำหอม",
    "อายแชโดว์",
  ],
  home_appliance: [
    "หม้อทอดไร้น้ำมัน",
    "เครื่องชงกาแฟ",
    "พัดลมไอเย็น",
    "เครื่องดูดฝุ่น",
    "หม้อหุงข้าว",
    "เครื่องฟอกอากาศ",
    "เตารีดไอน้ำ",
    "ไมโครเวฟ",
    "เครื่องปั่น",
  ],
  sports_fitness: [
    "ดัมเบล",
    "เสื่อโยคะ",
    "รองเท้าวิ่ง",
    "ขวดน้ำสปอร์ต",
    "ยางยืดออกกำลังกาย",
    "เสื้อกีฬา",
    "กางเกงโยคะ",
    "พ็อกเก็ตวิ่ง",
  ],
  mom_baby: [
    "ผ้าอ้อม",
    "นมผง",
    "ขวดนม",
    "รถเข็นเด็ก",
    "คาร์ซีท",
    "ของเล่นเสริมพัฒนาการ",
    "เสื้อผ้าเด็ก",
    "ที่นอนเด็ก",
  ],
  food_kitchen: [
    "กระทะ",
    "มีดทำครัว",
    "หม้อ stockpot",
    "เครื่องตีไข่",
    "กล่องอาหาร bento",
    "กระติกน้ำ",
    "ชุดจาน",
    "เครื่องคั้นน้ำผลไม้",
  ],
  fashion: [
    "กระเป๋าผู้หญิง",
    "รองเท้าผู้หญิง",
    "เสื้อโปโล",
    "กางเกงยีน",
    "แว่นตา",
    "ชุดออกกำลังกาย",
    "นาฬิกาผู้ชาย",
    "เครื่องประดับ",
  ],
  car_garage: [
    "กล้องติดรถยนต์",
    "ผ้าคลุมรถ",
    "น้ำมันเครื่อง",
    "เบาะนวดรถ",
    "เครื่องฟอกอากาศรถ",
    "ที่ดูดฝุ่นรถ",
  ],
};

export const ALL_NICHES = Object.keys(NICHE_KEYWORDS) as Niche[];

/**
 * Pick N random keywords across niches (cold-start: equal weight).
 * Sprint 9+ will replace this with bandit-weighted selection.
 */
export function pickKeywords(opts: {
  nichesToInclude?: Niche[];
  count: number;
}): Array<{ niche: Niche; keyword: string }> {
  const niches = opts.nichesToInclude ?? ALL_NICHES;
  const pool: Array<{ niche: Niche; keyword: string }> = [];
  for (const n of niches) {
    for (const kw of NICHE_KEYWORDS[n]) {
      pool.push({ niche: n, keyword: kw });
    }
  }
  // Fisher-Yates shuffle, take first N
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, opts.count);
}

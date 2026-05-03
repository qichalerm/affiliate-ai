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
 * Pick N keywords weighted by niche performance — Sprint 27 (M9 extension).
 *
 * Cold start: equal weight (random uniform). After enough click data
 * accumulates, niches with higher CTR/conversion get proportionally
 * more scrape budget. Implementation: weight per niche = max(1, clicks
 * in last 14 days), then sample N keywords with replacement weighted
 * by niche, picking a random keyword inside each chosen niche.
 *
 * The DB query is fail-soft — any error reverts to uniform random so
 * the scrape never breaks just because the bandit module is degraded.
 */
export async function pickKeywordsWeighted(opts: {
  count: number;
  nichesToInclude?: Niche[];
}): Promise<Array<{ niche: Niche; keyword: string }>> {
  const niches = opts.nichesToInclude ?? ALL_NICHES;

  let weights: Map<Niche, number>;
  try {
    weights = await loadNicheWeights(niches);
  } catch {
    weights = new Map(niches.map((n) => [n, 1]));
  }

  const totalWeight = Array.from(weights.values()).reduce((a, b) => a + b, 0) || 1;

  const out: Array<{ niche: Niche; keyword: string }> = [];
  for (let i = 0; i < opts.count; i++) {
    let r = Math.random() * totalWeight;
    let chosen: Niche = niches[0]!;
    for (const n of niches) {
      r -= weights.get(n) ?? 0;
      if (r <= 0) { chosen = n; break; }
    }
    const kws = NICHE_KEYWORDS[chosen];
    const kw = kws[Math.floor(Math.random() * kws.length)]!;
    out.push({ niche: chosen, keyword: kw });
  }
  return out;
}

/**
 * Compute weight per niche from last 14 days of click data joined to
 * products → niche. Niches with no clicks get weight=1 (baseline floor)
 * so they keep getting scraped enough to gather signal.
 */
async function loadNicheWeights(niches: Niche[]): Promise<Map<Niche, number>> {
  const { db } = await import("../lib/db.ts");
  const { sql } = await import("drizzle-orm");

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const rows = await db.execute<{ niche: string; clicks: number; [k: string]: unknown }>(sql`
    SELECT p.niche::text AS niche, COUNT(c.id)::int AS clicks
    FROM products p
    LEFT JOIN affiliate_links al ON al.product_id = p.id
    LEFT JOIN clicks c ON c.affiliate_link_id = al.id AND c.clicked_at >= ${since.toISOString()}::timestamptz
    WHERE p.niche IS NOT NULL
    GROUP BY p.niche
  `);

  // Map back, applying baseline=1 for unseen niches and adding 1 to all
  // (Laplace smoothing — keeps zero-click niches at non-zero weight)
  const weights = new Map<Niche, number>();
  for (const n of niches) weights.set(n, 1);
  for (const r of rows) {
    if (niches.includes(r.niche as Niche)) {
      weights.set(r.niche as Niche, Math.max(1, r.clicks + 1));
    }
  }
  return weights;
}

/**
 * Pick N random keywords (uniform weight). Kept for callers that don't
 * want to do an async DB query (e.g. one-shot test scripts).
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
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, opts.count);
}

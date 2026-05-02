/**
 * Map a Shopee search keyword to one of our seeded category slugs.
 * Used at scrape time so each ingested product gets a sensible category_id,
 * making /หมวด/{slug} pages actually populate.
 *
 * Keep in sync with NICHE_KEYWORDS in src/scheduler/jobs.ts.
 * Categories list: src/db/seeds.ts (or query: SELECT slug FROM categories).
 */

const RULES: Array<{ test: RegExp; slug: string }> = [
  // Audio
  { test: /tws|airpods|earbuds|in[\s-]?ear|หูฟังไร้สาย/i, slug: "tws-earbuds" },
  { test: /headphone|over[\s-]?ear|on[\s-]?ear|หูฟัง(?!ไร้สาย)|earphone/i, slug: "headphones" },
  { test: /speaker|ลำโพง|soundbar/i, slug: "speakers" },
  { test: /microphone|\bmic\b|ไมโครโฟน|ไมค์/i, slug: "microphones" },

  // Computer peripherals
  { test: /mouse|เมาส์|gaming\s+mouse/i, slug: "mice" },
  { test: /keyboard|คีย์บอร์ด|mechanical/i, slug: "keyboards" },
  { test: /monitor|จอภาพ|จอ\s?\d|หน้าจอ/i, slug: "monitors" },
  { test: /laptop\s+stand|ขาตั้ง.*โน[๊็้]?ตบุ[๊็้]?ค/i, slug: "laptop-stands" },
  { test: /webcam|เว็บแคม/i, slug: "webcams" },

  // Phone accessories
  { test: /powerbank|พาวเวอร์แบงค์|พาเวอร์แบงค์|พาวเวอร์|power\s?bank/i, slug: "powerbanks" },
  { test: /charger|ที่ชาร์จ|adapter|gan/i, slug: "chargers" },
  { test: /cable|สายชาร์จ|type[\s-]?c|usb[\s-]?c|lightning/i, slug: "cables" },
  { test: /phone\s+case|เคส(?:มือถือ|โทรศัพท์|iphone|samsung)/i, slug: "phone-cases" },

  // Wearables
  { test: /smart\s?watch|smartwatch/i, slug: "smartwatches" },
  { test: /fitness\s+tracker|smart\s?band|fitbit|mi\s?band/i, slug: "fitness-trackers" },
];

export function categoryForKeyword(keyword: string): string | null {
  for (const r of RULES) {
    if (r.test.test(keyword)) return r.slug;
  }
  return null;
}

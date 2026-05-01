/**
 * Seasonality boost — categorical adjustments based on calendar / weather / events.
 *
 * Returns a multiplier in [0.5, 2.0] applied to product score.
 * - 1.0 = neutral
 * - >1.0 = currently in season (boost)
 * - <1.0 = off-season (suppress)
 */

interface SeasonalRule {
  match: (input: { categoryId?: number | null; productName: string; today: Date }) => boolean;
  boost: number;
  reason: string;
}

const TH_HOLIDAY_BOOSTS: SeasonalRule[] = [
  // Songkran (April 13-15) — water gear, sunscreen
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const d = today.getDate();
      const inWindow =
        (m === 4 && d >= 1 && d <= 18) || (m === 3 && d >= 25);
      const re = /สงกรานต์|ปืนฉีดน้ำ|กันแดด|sunscreen|sun-?block|ที่กั้นน้ำ|กันน้ำ|ลำโพงกันน้ำ/i;
      return inWindow && re.test(productName);
    },
    boost: 1.6,
    reason: "songkran-april",
  },
  // 9.9 / 11.11 / 12.12 sale events — broad boost
  {
    match: ({ today }) => {
      const m = today.getMonth() + 1;
      const d = today.getDate();
      // 5 days leading up to sale events
      return (
        (m === 9 && d >= 4 && d <= 11) ||
        (m === 11 && d >= 6 && d <= 13) ||
        (m === 12 && d >= 7 && d <= 14)
      );
    },
    boost: 1.4,
    reason: "shopee-mega-sale",
  },
  // Hot season (April-May) — cooling products
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const inHotSeason = m === 4 || m === 5;
      const re = /พัดลม|แอร์|คูลลิ่ง|cool|ผ้าห่มเย็น|หม้อเย็น|ไอเย็น|usb fan|portable fan/i;
      return inHotSeason && re.test(productName);
    },
    boost: 1.5,
    reason: "hot-season-cooling",
  },
  // Rainy season (June-Oct) — umbrellas, rainproof
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const inRainy = m >= 6 && m <= 10;
      const re = /ร่ม|กันฝน|ผ้าคลุม|กันน้ำ|ผ้ากันน้ำ|raincoat|umbrella/i;
      return inRainy && re.test(productName);
    },
    boost: 1.4,
    reason: "rainy-season",
  },
  // Back-to-school (May, Oct)
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const isBts = m === 5 || m === 10;
      const re = /กระเป๋านักเรียน|เครื่องเขียน|ปากกา|สมุด|กล่องดินสอ|backpack|stationery/i;
      return isBts && re.test(productName);
    },
    boost: 1.3,
    reason: "back-to-school",
  },
  // Year-end (Dec) — gift items
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const d = today.getDate();
      const inGiftSeason = m === 12 && d >= 10;
      const re = /ของขวัญ|gift|set|pouch|กล่อง|hampers/i;
      return inGiftSeason && re.test(productName);
    },
    boost: 1.3,
    reason: "year-end-gifts",
  },
];

const ANTI_SEASON_RULES: SeasonalRule[] = [
  // Don't push winter wear in summer TH
  {
    match: ({ productName, today }) => {
      const m = today.getMonth() + 1;
      const inHot = m >= 3 && m <= 6;
      const re = /เสื้อหนาว|เสื้อกันหนาว|jacket|coat|ขนสัตว์|fleece/i;
      return inHot && re.test(productName);
    },
    boost: 0.7,
    reason: "winter-in-hot-season",
  },
];

export interface SeasonalityResult {
  boost: number;
  reasons: string[];
}

export function computeSeasonality(input: {
  categoryId?: number | null;
  productName: string;
  today?: Date;
}): SeasonalityResult {
  const today = input.today ?? new Date();
  let boost = 1.0;
  const reasons: string[] = [];

  for (const rule of TH_HOLIDAY_BOOSTS) {
    if (rule.match({ ...input, today })) {
      boost *= rule.boost;
      reasons.push(rule.reason);
    }
  }
  for (const rule of ANTI_SEASON_RULES) {
    if (rule.match({ ...input, today })) {
      boost *= rule.boost;
      reasons.push(rule.reason);
    }
  }

  return { boost: Math.max(0.5, Math.min(2.0, boost)), reasons };
}

/**
 * `bun run db:seed` — seed the categories table with the IT/Gadget niche taxonomy.
 * Idempotent — safe to re-run.
 */

import { db, schema, closeDb } from "../lib/db.ts";

const CATEGORIES = [
  // Top-level (depth 0)
  { slug: "it-gadget", nameTh: "IT & Gadget", nameEn: "IT & Gadget", parent: null, depth: 0 },

  // IT/Gadget sub-categories (depth 1)
  { slug: "audio", nameTh: "เครื่องเสียง", nameEn: "Audio", parent: "it-gadget", depth: 1 },
  { slug: "computer-peripherals", nameTh: "อุปกรณ์คอมพิวเตอร์", nameEn: "Computer Peripherals", parent: "it-gadget", depth: 1 },
  { slug: "phone-accessories", nameTh: "อุปกรณ์เสริมมือถือ", nameEn: "Phone Accessories", parent: "it-gadget", depth: 1 },
  { slug: "wearables", nameTh: "อุปกรณ์สวมใส่", nameEn: "Wearables", parent: "it-gadget", depth: 1 },
  { slug: "smart-home", nameTh: "Smart Home", nameEn: "Smart Home", parent: "it-gadget", depth: 1 },
  { slug: "gaming-gear", nameTh: "Gaming Gear", nameEn: "Gaming Gear", parent: "it-gadget", depth: 1 },

  // Audio (depth 2)
  { slug: "headphones", nameTh: "หูฟัง", nameEn: "Headphones", parent: "audio", depth: 2 },
  { slug: "tws-earbuds", nameTh: "หูฟังไร้สาย TWS", nameEn: "TWS Earbuds", parent: "audio", depth: 2 },
  { slug: "speakers", nameTh: "ลำโพง", nameEn: "Speakers", parent: "audio", depth: 2 },
  { slug: "microphones", nameTh: "ไมโครโฟน", nameEn: "Microphones", parent: "audio", depth: 2 },

  // Computer (depth 2)
  { slug: "mice", nameTh: "เมาส์", nameEn: "Mice", parent: "computer-peripherals", depth: 2 },
  { slug: "keyboards", nameTh: "คีย์บอร์ด", nameEn: "Keyboards", parent: "computer-peripherals", depth: 2 },
  { slug: "monitors", nameTh: "จอภาพ", nameEn: "Monitors", parent: "computer-peripherals", depth: 2 },
  { slug: "laptop-stands", nameTh: "ขาตั้งโน๊ตบุ๊ค", nameEn: "Laptop Stands", parent: "computer-peripherals", depth: 2 },
  { slug: "webcams", nameTh: "เว็บแคม", nameEn: "Webcams", parent: "computer-peripherals", depth: 2 },

  // Phone (depth 2)
  { slug: "powerbanks", nameTh: "Powerbank", nameEn: "Power Banks", parent: "phone-accessories", depth: 2 },
  { slug: "chargers", nameTh: "ที่ชาร์จ", nameEn: "Chargers", parent: "phone-accessories", depth: 2 },
  { slug: "cables", nameTh: "สายชาร์จ", nameEn: "Cables", parent: "phone-accessories", depth: 2 },
  { slug: "phone-cases", nameTh: "เคสโทรศัพท์", nameEn: "Phone Cases", parent: "phone-accessories", depth: 2 },

  // Wearables (depth 2)
  { slug: "smartwatches", nameTh: "Smart Watch", nameEn: "Smartwatches", parent: "wearables", depth: 2 },
  { slug: "fitness-trackers", nameTh: "Fitness Tracker", nameEn: "Fitness Trackers", parent: "wearables", depth: 2 },
];

async function main() {
  const slugToId = new Map<string, number>();

  for (const cat of CATEGORIES) {
    const parentId = cat.parent ? slugToId.get(cat.parent) ?? null : null;

    const existing = await db.query.categories.findFirst({
      where: (c, { eq }) => eq(c.slug, cat.slug),
      columns: { id: true },
    });

    if (existing) {
      slugToId.set(cat.slug, existing.id);
      console.log(`· ${cat.slug} (exists, id=${existing.id})`);
      continue;
    }

    const [row] = await db
      .insert(schema.categories)
      .values({
        slug: cat.slug,
        nameTh: cat.nameTh,
        nameEn: cat.nameEn,
        parentId,
        depth: cat.depth,
      })
      .returning({ id: schema.categories.id });
    slugToId.set(cat.slug, row.id);
    console.log(`+ ${cat.slug} (id=${row.id})`);
  }

  console.log(`\nSeeded ${CATEGORIES.length} categories.`);
  await closeDb();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

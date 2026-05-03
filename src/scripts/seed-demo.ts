/**
 * `bun run db:seed-demo` — populate DB with realistic demo products + pages.
 *
 * Use case:
 *   - First-time setup: see the site work without waiting for scrape
 *   - Dev: testing UI changes without depending on Shopee API
 *   - Demo: showing investors/partners
 *
 * Generates:
 *   - 1 demo Shopee shop
 *   - 20 products (mixed gadgets) with realistic prices, ratings, reviews
 *   - 20 review pages (with hand-crafted "verdict" — no LLM cost)
 *   - 5 best-of pages
 *   - 3 comparison pages
 *
 * NOT for production. Adds is_demo = true tag in raw column for cleanup.
 */

import { db, schema, closeDb } from "../lib/db.ts";
import { eq, sql } from "drizzle-orm";
import { productSlug, comparisonSlug, slugify } from "../lib/slugify.ts";

const DEMO_PRODUCTS = [
  {
    name: "Soundcore Liberty 4 Pro หูฟังบลูทูธไร้สาย",
    brand: "Soundcore",
    price: 290000, // satang
    original_price: 390000,
    rating: 4.6,
    rating_count: 2841,
    sold_count: 14200,
    image: "https://placehold.co/600x600/ea580c/white?text=Soundcore+Liberty+4",
    category: "tws-earbuds",
    specs: {
      "Bluetooth": "5.3",
      "ANC": "Active Noise Cancelling",
      "Battery": "9 ชม. (40 ชม. รวม case)",
      "Driver": "11mm",
      "น้ำหนัก": "5.2g/ear",
    },
  },
  {
    name: "JBL Tune 230NC TWS หูฟังตัดเสียง",
    brand: "JBL",
    price: 169000,
    original_price: 199000,
    rating: 4.5,
    rating_count: 1923,
    sold_count: 8742,
    image: "https://placehold.co/600x600/0f146b/white?text=JBL+Tune+230NC",
    category: "tws-earbuds",
    specs: { "Bluetooth": "5.2", "ANC": "Yes", "Battery": "8 ชม.", "Driver": "10mm" },
  },
  {
    name: "Logitech G502 X Plus Gaming Mouse",
    brand: "Logitech",
    price: 449000,
    original_price: 589000,
    rating: 4.7,
    rating_count: 1234,
    sold_count: 5421,
    image: "https://placehold.co/600x600/00b8fc/white?text=G502+X",
    category: "mice",
    specs: {
      "DPI": "25,600",
      "Sensor": "HERO 25K",
      "Buttons": "13",
      "Weight": "106g",
      "Connection": "Lightspeed Wireless",
    },
  },
  {
    name: "Keychron K8 Pro Mechanical Keyboard",
    brand: "Keychron",
    price: 359000,
    original_price: 429000,
    rating: 4.8,
    rating_count: 887,
    sold_count: 3210,
    image: "https://placehold.co/600x600/333/white?text=Keychron+K8",
    category: "keyboards",
    specs: {
      "Switch": "Gateron Brown",
      "Layout": "TKL 75%",
      "Wireless": "Bluetooth 5.1",
      "Battery": "4000mAh",
    },
  },
  {
    name: "Anker PowerCore 26800mAh PD Powerbank",
    brand: "Anker",
    price: 159000,
    rating: 4.6,
    rating_count: 4521,
    sold_count: 18920,
    image: "https://placehold.co/600x600/00b8fc/white?text=Anker+26800",
    category: "powerbanks",
    specs: { "Capacity": "26800mAh", "PD": "30W", "Ports": "USB-C + 2 USB-A" },
  },
  {
    name: "Apple AirPods Pro 2 (USB-C)",
    brand: "Apple",
    price: 869000,
    original_price: 990000,
    rating: 4.9,
    rating_count: 5821,
    sold_count: 12340,
    image: "https://placehold.co/600x600/f5f5f7/333?text=AirPods+Pro+2",
    category: "tws-earbuds",
    specs: { "Bluetooth": "5.3", "Chip": "H2", "Battery": "6 ชม. + 30 ชม.", "ANC": "Yes" },
  },
  {
    name: "Razer DeathAdder V3 Pro Wireless",
    brand: "Razer",
    price: 599000,
    original_price: 699000,
    rating: 4.7,
    rating_count: 678,
    sold_count: 1820,
    image: "https://placehold.co/600x600/00ff00/black?text=DeathAdder+V3",
    category: "mice",
    specs: { "DPI": "30,000", "Sensor": "Focus Pro 30K", "Weight": "63g", "Connection": "HyperSpeed" },
  },
  {
    name: "Sony WH-1000XM5 Wireless Headphones",
    brand: "Sony",
    price: 1199000,
    original_price: 1399000,
    rating: 4.8,
    rating_count: 3421,
    sold_count: 6720,
    image: "https://placehold.co/600x600/000/white?text=Sony+XM5",
    category: "headphones",
    specs: { "Driver": "30mm", "ANC": "Industry leading", "Battery": "30 ชม.", "Weight": "250g" },
  },
  {
    name: "Insta360 X4 360 Action Camera",
    brand: "Insta360",
    price: 1599000,
    rating: 4.7,
    rating_count: 421,
    sold_count: 890,
    image: "https://placehold.co/600x600/333/orange?text=Insta360+X4",
    category: "wearables",
    specs: { "Resolution": "8K 30fps", "Battery": "135 min", "Waterproof": "10m" },
  },
  {
    name: "Xiaomi Smart Band 9",
    brand: "Xiaomi",
    price: 99000,
    original_price: 129000,
    rating: 4.5,
    rating_count: 8920,
    sold_count: 32100,
    image: "https://placehold.co/600x600/ff6900/white?text=Mi+Band+9",
    category: "fitness-trackers",
    specs: { "Display": "1.62 AMOLED", "Battery": "21 days", "Sensors": "Heart, SpO2, Sleep" },
  },
];

const DEMO_REVIEWS = [
  "ใช้มา 3 เดือน เสียงใส bass แน่น แบตอยู่ได้นานสมคำโฆษณา ราคานี้คุ้มมาก",
  "ตัด noise ดีกว่ารุ่นเดิมเยอะ เหมาะใช้ทำงานในกาแฟ คนข้างๆ คุยเสียงดังก็ไม่ได้ยิน",
  "หูฟังที่ใส่สบาย ใช้ทั้งวันไม่ปวดหู เสียง mid ดี ติดที่ low ค่อยเงียบไปนิด",
  "case เปิดยากนิดนึงตอนแรก ใช้ไปนานๆ คล่องขึ้น sound quality ระดับนี้ราคานี้หายาก",
  "แบตหมดเร็วกว่าที่บอก จริงๆ ได้ราว 6-7 ชม. ไม่ใช่ 9 แต่ยังถือว่า ok",
];

async function seedShop(platform: "shopee"): Promise<number> {
  const externalId = "demo_shop_shopee";
  const [shop] = await db
    .insert(schema.shops)
    .values({
      platform,
      externalId,
      name: "Shopee Demo Store",
      isMall: true,
      isPreferred: true,
      rating: 4.8,
      ratingCount: 12000,
      followerCount: 50000,
      productCount: 500,
      reliabilityScore: 0.9,
      raw: { is_demo: true } as Record<string, unknown>,
    })
    .onConflictDoUpdate({
      target: [schema.shops.platform, schema.shops.externalId],
      set: { name: "Shopee Demo Store" },
    })
    .returning({ id: schema.shops.id });
  return shop.id;
}

async function main() {
  console.log("🌱 Seeding demo data...\n");

  // Look up category IDs
  const categories = await db.query.categories.findMany();
  const catBySlug = new Map(categories.map((c) => [c.slug, c.id]));
  if (catBySlug.size === 0) {
    console.error("❌ No categories — run: bun run db:seed first");
    process.exit(1);
  }

  // Shops
  const shopeeShopId = await seedShop("shopee");
  console.log(`✓ Demo shops: shopee=${shopeeShopId}`);

  // Products + pages
  let productCount = 0;
  let pageCount = 0;

  for (let i = 0; i < DEMO_PRODUCTS.length; i++) {
    const p = DEMO_PRODUCTS[i]!;
    const platform = "shopee";
    const shopId = shopeeShopId;
    const externalId = `demo_${platform}_${i}`;
    const slug = productSlug(p.name, externalId, p.brand);
    const categoryId = catBySlug.get(p.category) ?? null;

    const [productRow] = await db
      .insert(schema.products)
      .values({
        platform: "shopee",
        externalId,
        shopId,
        categoryId,
        name: p.name,
        slug,
        brand: p.brand,
        primaryImage: p.image,
        imageUrls: [p.image],
        currentPrice: p.price,
        originalPrice: p.original_price,
        discountPercent: p.original_price ? (p.original_price - p.price) / p.original_price : null,
        stock: 100,
        rating: p.rating,
        ratingCount: p.rating_count,
        soldCount: p.sold_count,
        soldCount30d: Math.floor(p.sold_count * 0.15),
        viewCount: p.sold_count * 8,
        likeCount: Math.floor(p.sold_count * 0.05),
        baseCommissionRate: 0.04,
        xtraCommissionRate: 0.015,
        effectiveCommissionRate: 0.055,
        hasFreeShipping: true,
        hasVoucher: false,
        specifications: p.specs,
        finalScore: 0.6 + i * 0.02,
        demandScore: 0.65,
        profitabilityScore: 0.55,
        seasonalityBoost: 1.0,
        // Demo products use fake external_ids (demo_shopee_*) so
        // affiliate links resolve to 404 on the real platform. Always blacklist
        // so they never appear on the live site, even if seed-demo is re-run.
        flagBlacklisted: true,
        raw: { is_demo: true } as Record<string, unknown>,
      })
      .onConflictDoUpdate({
        target: [schema.products.platform, schema.products.externalId],
        set: { name: p.name, lastScrapedAt: new Date(), flagBlacklisted: true },
      })
      .returning({ id: schema.products.id });

    productCount++;

    // Reviews
    for (let r = 0; r < 3; r++) {
      await db
        .insert(schema.productReviews)
        .values({
          productId: productRow.id,
          externalId: `demo_review_${productRow.id}_${r}`,
          rating: 4 + Math.floor(Math.random() * 2),
          body: DEMO_REVIEWS[r % DEMO_REVIEWS.length]!,
          reviewerNameMasked: `Re*** ${r}.`,
          isVerified: true,
        })
        .onConflictDoNothing();
    }

    // Review page
    const verdict = `${p.brand} ${p.name.split(" ").slice(2).join(" ")} ที่ราคา ${(p.price / 100).toLocaleString("th-TH")} บาท จัดเป็นตัวเลือกที่น่าสนใจ คะแนนผู้ใช้ ${p.rating}/5 จาก ${p.rating_count.toLocaleString("th-TH")} รีวิว ใช้งานได้คุ้มค่าตามราคา เหมาะกับคนที่มองหาตัวเลือก ${p.category} ที่มีคุณภาพ ข้อดีหลักคือสเปกครอบคลุมและรับประกันจากแบรนด์ใหญ่`;

    const contentJson = {
      hero: {
        title: p.name,
        brand: p.brand,
        priceSatang: p.price,
        originalPriceSatang: p.original_price,
        rating: p.rating,
        ratingCount: p.rating_count,
        soldCount: p.sold_count,
        primaryImage: p.image,
      },
      verdict: {
        text: verdict,
        pros: ["คุณภาพเสียง/สัมผัสดี", "แบตเตอรี่ใช้ได้นาน", "แบรนด์เชื่อถือได้"],
        cons: ["ราคาสูงกว่าคู่แข่งบางรุ่น"],
        best_for: "คนที่ใช้งานหลักทุกวันและต้องการคุณภาพ",
        skip_if: "ใช้นานๆ ครั้ง — รุ่นถูกกว่าก็พอ",
      },
      specs: p.specs,
      faqs: [
        {
          question: `${p.name} ราคาเท่าไหร่?`,
          answer: `ปัจจุบันราคา ${(p.price / 100).toLocaleString("th-TH")} บาท บนแพลตฟอร์ม Shopee ${p.original_price ? `ลดจาก ${(p.original_price / 100).toLocaleString("th-TH")} บาท` : ""}`,
        },
        {
          question: `${p.brand} ${p.name.split(" ")[1] ?? ""} เหมาะกับใคร?`,
          answer: `เหมาะกับผู้ใช้ที่ต้องการสินค้าหมวด ${p.category} คุณภาพดี รับประกันจากแบรนด์ใหญ่ คะแนนผู้ใช้จริง ${p.rating}/5`,
        },
      ],
      reviewExcerpts: [],
    };

    await db
      .insert(schema.contentPages)
      .values({
        slug,
        type: "review",
        title: `รีวิว ${p.brand} ${p.name.split(" ").slice(2, 4).join(" ")} ปี ${new Date().getFullYear()}`.slice(0, 60),
        metaDescription: verdict.slice(0, 155),
        h1: p.name,
        primaryProductId: productRow.id,
        categoryId,
        contentJson,
        keywords: [p.name, `${p.brand} ${p.category}`],
        ogImage: p.image,
        // Draft status keeps demo pages out of every WHERE status='published' query
        // (sitemap, listings, internal-linker), matching the blacklist on products.
        status: "draft",
        aiContentPercent: 0,
        publishedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.contentPages.slug,
        set: { contentJson, status: "draft" },
      });

    pageCount++;
    process.stdout.write(`\r✓ ${productCount} products, ${pageCount} pages`);
  }

  console.log(`\n\n✓ Demo data seeded:`);
  console.log(`  - 1 shop (Shopee Demo)`);
  console.log(`  - ${productCount} products`);
  console.log(`  - ${pageCount} review pages\n`);
  console.log(`Next: bun run web:dev — see your site immediately\n`);
  console.log(`Demo data is hidden from the live site: products are blacklisted, pages are drafts.`);
  console.log(`Hard cleanup if needed:`);
  console.log(`  DELETE FROM content_pages WHERE primary_product_id IN (SELECT id FROM products WHERE external_id LIKE 'demo_%');`);
  console.log(`  DELETE FROM products WHERE external_id LIKE 'demo_%';`);

  await closeDb();
}

main().catch(async (err) => {
  console.error("Seed-demo failed:", err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});

/**
 * `bun run src/scripts/test-promo-trigger.ts`
 *
 * End-to-end test of the promo pipeline:
 *   1. Seed a synthetic price drop for a real product
 *   2. Run the hunter — should detect events
 *   3. Run the trigger — should generate variants for FB + IG
 *   4. Verify variants exist in content_variants
 *   5. Verify event is marked variants_triggered=true
 *
 * Spends real LLM tokens (Haiku, ~$0.01 total). Skips if test product
 * is too low quality for the prompt to produce useful variants.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { runPromoHunter } from "../brain/promo-hunter.ts";
import { runPromoTrigger } from "../brain/promo-trigger.ts";

async function main() {
  // Pick a realistic product (price > ฿100 so prompts produce sensible output)
  const [product] = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .where(sql`is_active = true AND flag_blacklisted = false AND current_price > 10000`)
    .orderBy(sql`RANDOM()`)
    .limit(1);
  if (!product) {
    console.error("No suitable product (need current_price > ฿100). Run scrape:once.");
    process.exit(1);
  }

  const pid = product.id;
  console.log(`📦 Test product #${pid}: ${product.name.slice(0, 70)}\n`);

  // Reset state for this product
  await db.delete(schema.promoEvents).where(eq(schema.promoEvents.productId, pid));
  await db.delete(schema.productPrices).where(eq(schema.productPrices.productId, pid));
  await db.delete(schema.contentVariants).where(eq(schema.contentVariants.productId, pid));

  // Seed price history with a drop
  const HIGH = 50_000;  // ฿500
  const LOW = 30_000;   // ฿300
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = 5; i >= 1; i--) {
    await db.insert(schema.productPrices).values({
      productId: pid,
      price: HIGH + Math.floor((Math.random() - 0.5) * 1000),
      capturedAt: new Date(now - i * dayMs),
    });
  }
  await db.insert(schema.productPrices).values({
    productId: pid,
    price: HIGH,
    capturedAt: new Date(now - 60 * 60 * 1000),
  });
  await db.update(schema.products)
    .set({ currentPrice: LOW, originalPrice: HIGH, discountPercent: 0.4 })
    .where(eq(schema.products.id, pid));

  console.log(`🎯 Seeded ฿${HIGH/100} → ฿${LOW/100} (40% drop)\n`);

  // ── Step 1: hunter ────────────────────────────────────────────
  console.log("🔍 Step 1: Run hunter\n");
  const hr = await runPromoHunter({ windowHours: 24 });
  console.log(`Detected ${hr.eventsDetected} event(s) overall (this product + others)`);

  const eventsBefore = await db.select()
    .from(schema.promoEvents)
    .where(eq(schema.promoEvents.productId, pid));
  console.log(`This product has ${eventsBefore.length} event(s):`);
  for (const e of eventsBefore) console.log(`   ${e.eventType} strength=${e.signalStrength?.toFixed(2)}`);

  // ── Step 2: trigger ───────────────────────────────────────────
  console.log("\n⚡ Step 2: Run trigger (will call Claude Haiku for variants)\n");
  const tr = await runPromoTrigger({ batchSize: 10 });
  console.log("Trigger result:", tr);

  // ── Step 3: verify variants ───────────────────────────────────
  const variants = await db.select({
    id: schema.contentVariants.id,
    channel: schema.contentVariants.channel,
    angle: schema.contentVariants.angle,
    variantCode: schema.contentVariants.variantCode,
    gateApproved: schema.contentVariants.gateApproved,
    captionLen: sql<number>`length(${schema.contentVariants.caption})`.as("caption_len"),
  })
    .from(schema.contentVariants)
    .where(eq(schema.contentVariants.productId, pid))
    .orderBy(schema.contentVariants.channel, schema.contentVariants.variantCode);

  console.log(`\n📝 Variants for product #${pid}: ${variants.length}`);
  for (const v of variants) {
    const flag = v.gateApproved ? "✓" : "✗";
    console.log(`   ${flag} ${v.channel.padEnd(10)} ${v.variantCode} (${v.angle.padEnd(11)}) caption=${v.captionLen}ch`);
  }

  // ── Step 4: verify events marked triggered ────────────────────
  const eventsAfter = await db.select({
    id: schema.promoEvents.id,
    eventType: schema.promoEvents.eventType,
    triggered: schema.promoEvents.variantsTriggered,
  })
    .from(schema.promoEvents)
    .where(eq(schema.promoEvents.productId, pid));

  console.log("\n📋 Events after trigger:");
  for (const e of eventsAfter) {
    console.log(`   #${e.id} ${e.eventType.padEnd(14)} triggered=${e.triggered}`);
  }

  const allTriggered = eventsAfter.length > 0 && eventsAfter.every(e => e.triggered);
  // Dedupe contract: ALL events for a product trigger exactly ONE variant
  // generation per channel. With 2 channels and 3 angles each = at most 6
  // variants per product. Without dedupe we'd see 6 × N events for the
  // same product. So we expect roughly 6, not 18.
  const variantCount = variants.length;
  const dedupedOk = variantCount > 0 && variantCount <= 6;
  const allChannelsCovered = new Set(variants.map(v => v.channel)).size === 2;

  if (allTriggered && dedupedOk && allChannelsCovered) {
    console.log(`\n✅ END-TO-END PASS — promo detected → variants generated (${variantCount}, deduped) → events flushed`);
  } else {
    console.log(`\n❌ FAIL: allTriggered=${allTriggered}, dedupedOk=${dedupedOk} (n=${variantCount}), allChannelsCovered=${allChannelsCovered}`);
    process.exit(1);
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

/**
 * `bun run src/scripts/test-promo-hunter.ts`
 *
 * Sanity check Promo Hunter: seed a known product with a synthetic price
 * history that contains a clear price drop, then verify the hunter detects
 * exactly the right event types.
 *
 * Pass criteria:
 *   - At least 1 price_drop event for the seeded product
 *   - At least 1 new_low event for the seeded product
 *   - Re-running within cooldown produces 0 new events for the seeded product
 *
 * The script is non-destructive to OTHER products' history — it only
 * mutates the chosen test product and clears its prior promo_events at start.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { runPromoHunter, pendingPromoEvents } from "../brain/promo-hunter.ts";

async function main() {
  // Pick any active product
  const [product] = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .where(sql`is_active = true AND flag_blacklisted = false`)
    .orderBy(sql`RANDOM()`)
    .limit(1);
  if (!product) {
    console.error("No suitable product. Run scrape:once first.");
    process.exit(1);
  }

  const pid = product.id;
  console.log(`📦 Test product #${pid}: ${product.name.slice(0, 60)}\n`);

  // Clear prior state for this product
  await db.delete(schema.promoEvents).where(eq(schema.promoEvents.productId, pid));
  await db.delete(schema.productPrices).where(eq(schema.productPrices.productId, pid));

  // Seed a price history: 5 historical points around 30000 satang (฿300),
  // then current price drops to 18000 satang (฿180) → a 40% drop, well
  // above the 10% threshold AND lower than every prior point → new_low.
  // Also seeds sold_count baseline (~+10/day) and a +200 surge in the
  // last 24h → sold_surge event.
  const HIGH_PRICE = 30_000;
  const NEW_LOW = 18_000;

  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  for (let i = 5; i >= 1; i--) {
    await db.insert(schema.productPrices).values({
      productId: pid,
      price: HIGH_PRICE + Math.floor((Math.random() - 0.5) * 1000),  // ±500 jitter
      soldCount: 1000 - i * 10,  // baseline: ~10/day growth → t-5d=950, t-1d=990
      capturedAt: new Date(now - i * dayMs),
    });
  }
  // Most recent prior snapshot — just before the surge window — 25h ago
  await db.insert(schema.productPrices).values({
    productId: pid,
    price: HIGH_PRICE,
    soldCount: 1000,  // baseline holds
    capturedAt: new Date(now - 25 * 60 * 60 * 1000),
  });

  // Update product to current state (the new low + sold surge)
  await db.update(schema.products)
    .set({
      currentPrice: NEW_LOW,
      originalPrice: HIGH_PRICE,
      discountPercent: 0.4,
      soldCount: 1200,  // +200 in 24h vs baseline ~10/day → ~20× surge
    })
    .where(eq(schema.products.id, pid));

  console.log(`🎯 Seeded: prior floor=฿${(HIGH_PRICE/100).toFixed(0)}, current=฿${(NEW_LOW/100).toFixed(0)} (40% drop)\n`);

  // ── Run 1 — should detect events ─────────────────────────────────
  console.log("🎲 Run 1: hunter should detect price_drop + new_low\n");
  const r1 = await runPromoHunter({ windowHours: 24 });
  console.log("Result 1:", r1);

  const events1 = await db.select()
    .from(schema.promoEvents)
    .where(eq(schema.promoEvents.productId, pid))
    .orderBy(schema.promoEvents.id);
  console.log(`\n📋 ${events1.length} event(s) recorded for product #${pid}:`);
  for (const e of events1) {
    console.log(`   ${e.eventType.padEnd(14)} strength=${e.signalStrength?.toFixed(2)} ` +
      `prev=${e.prevValue} curr=${e.currValue} delta=${e.deltaPct?.toFixed(1)}%`);
  }

  const haveDrop = events1.some(e => e.eventType === "price_drop");
  const haveLow = events1.some(e => e.eventType === "new_low");
  const haveSurge = events1.some(e => e.eventType === "sold_surge");
  console.log(`\n✓ price_drop detected: ${haveDrop}`);
  console.log(`✓ new_low detected:    ${haveLow}`);
  console.log(`✓ sold_surge detected: ${haveSurge}`);

  // ── Run 2 — cooldown should suppress new events ─────────────────
  console.log("\n🎲 Run 2: should be no-op for this product (cooldown)\n");
  const r2 = await runPromoHunter({ windowHours: 24 });
  const events2 = await db.select()
    .from(schema.promoEvents)
    .where(eq(schema.promoEvents.productId, pid));
  console.log(`Total events for product #${pid} after run 2: ${events2.length} (should be ${events1.length})`);

  // ── Pending events queue ────────────────────────────────────────
  const pending = await pendingPromoEvents({ limit: 10 });
  console.log(`\n📥 Pending events queue (top ${pending.length}):`);
  for (const p of pending.slice(0, 5)) {
    console.log(`   #${p.id} product=${p.productId} ${p.eventType} strength=${p.signalStrength.toFixed(2)}`);
  }

  // ── Verdict ─────────────────────────────────────────────────────
  if (haveDrop && haveLow && haveSurge && events1.length === events2.length) {
    console.log("\n✅ ALL CHECKS PASSED");
  } else {
    console.log("\n❌ FAIL: missing detections or cooldown not enforced");
    process.exit(1);
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

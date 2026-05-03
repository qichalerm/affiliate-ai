/**
 * `bun run src/scripts/test-bandit.ts`
 *
 * Sanity check Thompson Sampling: simulate clicks with known winners,
 * verify the bandit converges to picking the winner more often.
 *
 * Setup:
 *   - Use existing scraped product
 *   - Generate 3 variants for "facebook"
 *   - Manually inject "ground truth" click rates: A=10%, B=20%, C=50%
 *   - Run pickVariant 1000 times, simulate clicks per ground truth
 *   - After 1000 picks, variant C should have most picks (exploit)
 */

import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { pickVariantBandit, bumpVariantClick } from "../brain/bandit.ts";

async function main() {
  // Use any product (variants regenerated each run)
  const [product] = await db
    .select({ id: schema.products.id, name: schema.products.name })
    .from(schema.products)
    .where(sql`current_price > 5000 AND discount_percent < 0.7`)
    .orderBy(sql`RANDOM()`)
    .limit(1);
  if (!product) {
    console.error("No suitable product. Run scrape:once first.");
    process.exit(1);
  }

  const productId = product.id;
  const channel = "facebook";

  console.log(`📦 Product #${productId}: ${product.name.slice(0, 50)}\n`);

  // Clear any existing variants for clean test
  await db
    .delete(schema.contentVariants)
    .where(sql`product_id = ${productId} AND channel = 'facebook'`);

  // Insert 3 fake variants with known ground-truth conversion rates
  const groundTruth = [
    { code: "A", angle: "deal" as const,        truePr: 0.10, label: "10% (loser)" },
    { code: "B", angle: "story" as const,       truePr: 0.20, label: "20% (medium)" },
    { code: "C", angle: "educational" as const, truePr: 0.50, label: "50% (winner)" },
  ];

  for (const v of groundTruth) {
    await db.insert(schema.contentVariants).values({
      productId,
      channel,
      angle: v.angle,
      variantCode: v.code,
      caption: `[fake-${v.code}] test variant`,
      gateApproved: true,
      isActive: true,
    });
  }

  console.log("🎯 Ground truth click probabilities:");
  for (const v of groundTruth) console.log(`   Variant ${v.code} (${v.angle}): ${v.label}`);

  // Run 500 pick-and-simulate cycles
  const N = 500;
  console.log(`\n🎲 Running ${N} Thompson Sampling rounds...\n`);

  const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
  for (let i = 0; i < N; i++) {
    const pick = await pickVariantBandit(productId, channel);
    if (!pick) throw new Error("pick returned null");
    counts[pick.variantCode] = (counts[pick.variantCode] ?? 0) + 1;

    // Simulate click per ground truth
    const truth = groundTruth.find((g) => g.code === pick.variantCode)!;
    if (Math.random() < truth.truePr) {
      await bumpVariantClick(pick.contentVariantId);
    }
  }

  // Show final distribution
  console.log("📊 Pick distribution after", N, "rounds:");
  for (const v of groundTruth) {
    const pct = ((counts[v.code] ?? 0) / N) * 100;
    const bar = "█".repeat(Math.round(pct / 2));
    console.log(`   ${v.code} (${v.angle.padEnd(11)}): ${(counts[v.code] ?? 0).toString().padStart(3)} (${pct.toFixed(1)}%) ${bar}`);
  }

  // Show actual click rates achieved
  const final = await db.query.contentVariants.findMany({
    where: (v, { and }) => and(eq(v.productId, productId), eq(v.channel, channel)),
    orderBy: (v) => v.variantCode,
  });
  console.log("\n📈 Observed CTR per variant:");
  for (const v of final) {
    const ctr = v.timesShown > 0 ? (v.timesClicked / v.timesShown) * 100 : 0;
    console.log(`   ${v.variantCode}: ${v.timesClicked}/${v.timesShown} = ${ctr.toFixed(1)}%`);
  }

  console.log("\n✓ Expected: C picked most often (true rate 50% — winner). Bandit should converge after ~100-200 rounds.");
  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

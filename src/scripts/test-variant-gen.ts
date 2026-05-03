/**
 * `bun run src/scripts/test-variant-gen.ts [productId] [channel]`
 *
 * Generates 3 content variants for a product on a channel, runs them
 * through the quality gate, persists results.
 *
 * If no productId given, picks a random scraped product.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { generateVariants } from "../content/variant-generator.ts";
import type { Platform } from "../quality/platform-rules.ts";

async function main() {
  const cliProductId = process.argv[2] ? Number.parseInt(process.argv[2], 10) : undefined;
  const channel = (process.argv[3] ?? "facebook") as Platform;

  let productId = cliProductId;
  if (!productId) {
    const [row] = await db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(eq(schema.products.platform, "shopee"))
      .orderBy(sql`RANDOM()`)
      .limit(1);
    if (!row) {
      console.error("No products in DB. Run scrape:once first.");
      process.exit(1);
    }
    productId = row.id;
    console.log(`📦 Picked random product #${row.id}: ${row.name.slice(0, 60)}\n`);
  }

  console.log(`🎨 Generating variants for product=${productId} channel=${channel}\n`);

  const result = await generateVariants({
    productId,
    channel,
    force: true,
  });

  console.log("\n📊 Result:");
  console.log(`   Generated: ${result.generated}`);
  console.log(`   Approved:  ${result.approved}`);
  console.log(`   Failed:    ${result.failed}`);
  console.log(`   Skipped:   ${result.skipped}`);
  console.log(`   LLM cost:  $${result.totalCostUsd.toFixed(6)}`);

  // Show generated content
  console.log("\n📝 Generated variants:");
  const variants = await db.query.contentVariants.findMany({
    where: (v, { and }) =>
      and(eq(v.productId, productId!), eq(v.channel, channel)),
    orderBy: (v, { desc }) => desc(v.createdAt),
    limit: result.generated,
  });
  for (const v of variants) {
    const status = v.gateApproved ? "✅ APPROVED" : "❌ REJECTED";
    console.log(`\n  ─── Variant ${v.variantCode} (${v.angle}) ${status} ───`);
    console.log(`  ${v.caption}`);
    if (!v.gateApproved && v.gateIssues?.length) {
      console.log(`  Issues: ${v.gateIssues.join("; ")}`);
    }
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

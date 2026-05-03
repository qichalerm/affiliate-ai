/**
 * `bun run src/scripts/test-link.ts` — end-to-end test for M8 click tracking.
 *
 * Flow:
 *   1. Insert a test shop + product (rolled back at end)
 *   2. Generate an affiliate link for the product
 *   3. Print the short URL (you can curl it and watch the click get logged)
 *   4. Print click stats
 *   5. Optionally cleanup the test fixtures
 *
 * Usage:
 *   bun run src/scripts/test-link.ts            # create test link, leave it
 *   bun run src/scripts/test-link.ts --cleanup  # also delete the test data after
 */

import { eq } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { createAffiliateLink } from "../affiliate/link-generator.ts";
import { getClickStats } from "../affiliate/click-logger.ts";
import { env } from "../lib/env.ts";

async function main() {
  const cleanup = process.argv.includes("--cleanup");

  console.log("📦 Setting up test fixture (shop + product)...\n");

  // Test shop
  const [shop] = await db
    .insert(schema.shops)
    .values({
      platform: "shopee",
      externalId: "test_shop_m8",
      name: "M8 Test Shop",
      isMall: true,
      rating: 4.8,
      ratingCount: 1000,
    })
    .onConflictDoUpdate({
      target: [schema.shops.platform, schema.shops.externalId],
      set: { name: "M8 Test Shop" },
    })
    .returning({ id: schema.shops.id });

  // Test product
  const [product] = await db
    .insert(schema.products)
    .values({
      platform: "shopee",
      externalId: "test_product_m8_v1",
      shopId: shop!.id,
      name: "M8 Test Product — Wireless Earbuds",
      slug: "m8-test-wireless-earbuds",
      brand: "TestBrand",
      currentPrice: 49900, // 499.00 baht
      originalPrice: 99900,
      discountPercent: 0.5,
      rating: 4.7,
      ratingCount: 234,
    })
    .onConflictDoUpdate({
      target: [schema.products.platform, schema.products.externalId],
      set: { name: "M8 Test Product — Wireless Earbuds" },
    })
    .returning({ id: schema.products.id });

  console.log(`   ✓ shop id=${shop!.id}, product id=${product!.id}\n`);

  // Generate links for each marketing channel
  console.log("🔗 Generating affiliate links per channel...\n");
  const channels = ["facebook", "instagram", "tiktok", "shopee_video", "web"] as const;
  const results: Array<{ channel: string; shortUrl: string; fullUrl: string }> = [];
  for (const channel of channels) {
    const r = await createAffiliateLink({
      productId: product!.id,
      channel,
      campaign: "m8_smoke_test",
      variant: "A",
    });
    results.push({ channel, shortUrl: r.shortUrl, fullUrl: r.fullUrl });
  }

  console.log("│ Channel       │ Short URL                        │");
  console.log("├───────────────┼──────────────────────────────────┤");
  for (const r of results) {
    console.log(`│ ${r.channel.padEnd(13)} │ ${r.shortUrl.padEnd(32)} │`);
  }

  console.log("\n📋 Sample destination URL (facebook variant):");
  console.log(`   ${results[0]!.fullUrl}\n`);

  // Test the redirect server (if running)
  console.log("🧪 Testing redirect server at localhost:3001 ...");
  const testShortId = results[0]!.shortUrl.split("/").pop()!;
  try {
    const res = await fetch(`http://localhost:3001/go/${testShortId}`, {
      redirect: "manual",
      headers: { "user-agent": "M8-test-script/1.0" },
    });
    if (res.status === 302) {
      const dest = res.headers.get("location");
      console.log(`   ✓ Redirect 302 → ${dest?.slice(0, 80)}...`);
    } else {
      console.log(`   ⚠ Unexpected status: ${res.status} (is the server running?)`);
    }
  } catch (err) {
    console.log(`   ⚠ Could not reach redirect server: ${(err as Error).message}`);
    console.log(`     Start it with: bun run src/web/redirect-server.ts`);
  }

  // Show click stats
  console.log("\n📊 Click stats per shortId:");
  for (const r of results) {
    const shortId = r.shortUrl.split("/").pop()!;
    const stats = await getClickStats(shortId);
    console.log(
      `   ${shortId}  →  total=${stats.total}  unique=${stats.unique_clicks}  bot=${stats.bot_clicks}`,
    );
  }

  if (cleanup) {
    console.log("\n🧹 Cleaning up test fixtures...");
    // Delete clicks first (FK cascade should handle, but be explicit)
    await db.delete(schema.clicks).where(eq(schema.clicks.shortId, results[0]!.shortUrl.split("/").pop()!));
    for (const r of results) {
      const shortId = r.shortUrl.split("/").pop()!;
      await db.delete(schema.affiliateLinks).where(eq(schema.affiliateLinks.shortId, shortId));
    }
    await db.delete(schema.products).where(eq(schema.products.id, product!.id));
    await db.delete(schema.shops).where(eq(schema.shops.id, shop!.id));
    console.log("   ✓ deleted");
  } else {
    console.log(
      `\n💡 Test data left in DB. Re-run with --cleanup to remove. Domain in URLs uses ${env.DOMAIN_NAME}.`,
    );
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test-link failed:", err);
  process.exit(1);
});

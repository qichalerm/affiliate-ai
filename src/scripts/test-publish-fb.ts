/**
 * `bun run src/scripts/test-publish-fb.ts [productId]`
 *
 * End-to-end dry-run for FB publisher:
 *   1. Pick variant from content_variants (must have approved one)
 *   2. Publish to Facebook (dry-run mode if no Meta token)
 *   3. Log to published_posts
 *
 * If product has no approved variant, generates one first.
 */

import { eq, sql } from "drizzle-orm";
import { db, schema, closeDb } from "../lib/db.ts";
import { generateVariants } from "../content/variant-generator.ts";
import { publishToFacebook } from "../publisher/facebook.ts";

async function main() {
  const cliProductId = process.argv[2] ? Number.parseInt(process.argv[2], 10) : undefined;

  let productId = cliProductId;
  if (!productId) {
    // Pick a real-priced product (avoid decoy ฿1 listings)
    const [row] = await db
      .select({ id: schema.products.id, name: schema.products.name })
      .from(schema.products)
      .where(sql`current_price > 5000 AND discount_percent < 0.7`)
      .orderBy(sql`RANDOM()`)
      .limit(1);
    if (!row) {
      console.error("No suitable products in DB. Run scrape:once first.");
      process.exit(1);
    }
    productId = row.id;
    console.log(`📦 Picked product #${row.id}: ${row.name.slice(0, 60)}\n`);
  }

  // Ensure approved variant exists
  const existing = await db.query.contentVariants.findMany({
    where: (v, { and }) =>
      and(
        eq(v.productId, productId!),
        eq(v.channel, "facebook"),
        eq(v.gateApproved, true),
      ),
    limit: 1,
  });

  if (existing.length === 0) {
    console.log("🎨 No approved variant — generating now...\n");
    await generateVariants({
      productId,
      channel: "facebook",
      force: true,
    });
  }

  console.log("📘 Publishing to Facebook (dry-run if no token)...\n");
  const result = await publishToFacebook({ productId });

  console.log("\n📊 Result:");
  console.log(`   Mode:          ${result.dryRun ? "DRY-RUN (no Meta token)" : "LIVE"}`);
  console.log(`   Status:        ${result.status}`);
  console.log(`   Post ID (DB):  ${result.publishedPostId}`);
  console.log(`   Variant ID:    ${result.variantId}`);
  console.log(`   Platform ID:   ${result.platformPostId}`);
  console.log(`   Platform URL:  ${result.platformPostUrl}`);
  if (result.errorMsg) console.log(`   Error:         ${result.errorMsg}`);

  // Show what was actually written to DB
  if (result.publishedPostId) {
    const post = await db.query.publishedPosts.findFirst({
      where: eq(schema.publishedPosts.id, result.publishedPostId),
    });
    if (post) {
      console.log("\n📝 Caption that would be posted:");
      console.log("   " + (post.captionPosted?.slice(0, 300) ?? "(empty)"));
      if ((post.captionPosted?.length ?? 0) > 300) console.log("   ...");
    }
  }

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});

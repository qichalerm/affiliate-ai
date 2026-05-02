/**
 * `bun run src/scripts/backfill-categories.ts`
 *
 * One-shot backfill: assign category_id to existing Apify-scraped products
 * by mapping their last scrape keyword to a category via keyword-category rules.
 *
 * Idempotent — re-running just keeps the assigned categories.
 */

import { db, schema, closeDb } from "../lib/db.ts";
import { sql, eq, inArray } from "drizzle-orm";
import { categoryForKeyword } from "../scraper/shopee/keyword-category.ts";

interface UpdatePlan {
  productId: number;
  productSlug: string;
  oldCat: number | null;
  newCat: number;
  newCatSlug: string;
  via: string;
}

async function main() {
  // Load all categories once
  const cats = await db.select({ id: schema.categories.id, slug: schema.categories.slug }).from(schema.categories);
  const catBySlug = new Map(cats.map((c) => [c.slug, c.id]));

  // Find each product's last scrape keyword via scraper_runs
  // (target column for the apify path is "apify:{keyword}")
  const rows = await db.execute<{
    product_id: number;
    product_slug: string;
    category_id: number | null;
    last_target: string | null;
  }>(sql`
    WITH last_runs AS (
      SELECT
        p.id AS product_id,
        p.slug AS product_slug,
        p.category_id,
        (
          SELECT sr.target
            FROM scraper_runs sr
           WHERE sr.scraper LIKE 'shopee%'
             AND sr.status = 'success'
             AND sr.started_at >= p.first_seen_at - interval '5 min'
             AND sr.started_at <= p.last_scraped_at + interval '5 min'
           ORDER BY sr.started_at DESC
           LIMIT 1
        ) AS last_target
      FROM products p
      WHERE p.is_active = true
    )
    SELECT * FROM last_runs WHERE last_target IS NOT NULL
  `);

  console.log(`Found ${rows.length} products with a known scrape keyword`);

  const plans: UpdatePlan[] = [];
  for (const r of rows) {
    const target = r.last_target ?? "";
    const keyword = target.replace(/^apify:/, "");
    const slug = categoryForKeyword(keyword);
    if (!slug) continue;
    const newCat = catBySlug.get(slug);
    if (!newCat) continue;
    if (r.category_id === newCat) continue; // already correct
    plans.push({
      productId: r.product_id,
      productSlug: r.product_slug,
      oldCat: r.category_id,
      newCat,
      newCatSlug: slug,
      via: keyword,
    });
  }

  console.log(`\n${plans.length} products need category update:`);
  const grouped = new Map<string, number>();
  for (const p of plans) grouped.set(p.newCatSlug, (grouped.get(p.newCatSlug) ?? 0) + 1);
  for (const [s, n] of [...grouped.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s.padEnd(20)} ${n} products`);
  }

  if (plans.length === 0) {
    console.log("\nNothing to do.");
    await closeDb();
    process.exit(0);
  }

  // Batch update by target category
  let updated = 0;
  for (const [slug, _] of grouped) {
    const catId = catBySlug.get(slug);
    if (!catId) continue;
    const ids = plans.filter((p) => p.newCatSlug === slug).map((p) => p.productId);
    await db
      .update(schema.products)
      .set({ categoryId: catId })
      .where(inArray(schema.products.id, ids));
    updated += ids.length;
  }
  console.log(`\n✓ Updated ${updated} products`);

  await closeDb();
  process.exit(0);
}

main().catch((err) => {
  console.error("backfill failed:", err);
  process.exit(1);
});

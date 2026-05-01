/**
 * `bun run sitemap:build` — build sitemap.xml + submit to IndexNow & Google.
 */

import { buildSitemap } from "../seo/sitemap-builder.ts";
import { submitToIndexNow, writeIndexNowKeyFile } from "../seo/indexnow.ts";
import { batchNotifyGoogle } from "../seo/google-indexing.ts";
import { db, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { env } from "../lib/env.ts";
import * as path from "node:path";

async function main() {
  const submit = process.argv[2] !== "--no-submit";

  console.log("Building sitemap...\n");
  const sitemap = await buildSitemap();
  console.log(`✓ ${sitemap.totalUrls} URLs across ${sitemap.files.length} file(s)`);

  // IndexNow key file in /public
  const publicDir = path.join(process.cwd(), "src/web/public");
  await writeIndexNowKeyFile(publicDir);

  if (!submit) {
    console.log("\nSkipping submit (--no-submit)");
    await closeDb();
    return;
  }

  // Recent URLs only
  const recent = await db.execute<{ slug: string; type: string }>(sql`
    SELECT slug, type::text AS type
      FROM content_pages
     WHERE status = 'published'
       AND COALESCE(updated_at, published_at) > now() - interval '7 days'
     LIMIT 200
  `);

  const SITE = `https://${env.DOMAIN_NAME}`;
  const urls = recent.map((p) => {
    const prefix =
      p.type === "review" ? "/รีวิว/" : p.type === "comparison" ? "/เปรียบเทียบ/" : "/ของดี/";
    return `${SITE}${prefix}${p.slug}`;
  });

  console.log(`\nSubmitting ${urls.length} recent URLs...`);
  const indexNow = await submitToIndexNow(urls);
  console.log(`✓ IndexNow: ${indexNow.submitted} submitted, ${indexNow.failed} failed`);

  const google = await batchNotifyGoogle(urls);
  console.log(`✓ Google:   ${google.submitted} submitted, ${google.failed} failed`);

  await closeDb();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

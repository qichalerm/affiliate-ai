/**
 * `bun run compliance:check` — run compliance checks on all published pages.
 * Reports pages that need re-review (e.g. after a policy update).
 */

import { db, closeDb } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { checkContent } from "../compliance/checker.ts";

interface PageRow {
  id: number;
  slug: string;
  title: string;
  contentJson: { verdict?: { text: string } } | null;
}

async function main() {
  const pages = await db.execute<PageRow>(sql`
    SELECT id, slug, title, content_json AS "contentJson"
      FROM content_pages
     WHERE status = 'published'
  `);
  console.log(`Auditing ${pages.length} published pages...\n`);

  let passed = 0;
  let issues = 0;
  for (const p of pages) {
    const text = [p.title, p.contentJson?.verdict?.text ?? ""].filter(Boolean).join("\n");
    const result = await checkContent({ text, isAiGenerated: true, channel: "web" });
    if (result.passed) {
      passed++;
    } else {
      issues++;
      console.log(`⚠ #${p.id} ${p.slug}`);
      console.log(`  blocked: ${result.flags.forbiddenBlocked.join(", ")}`);
    }
  }
  console.log(`\nClean: ${passed} / Issues: ${issues}`);
  await closeDb();
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});

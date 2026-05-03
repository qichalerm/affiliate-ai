/**
 * Sitemap builder — generates sitemap.xml from DB content with hreflang variants.
 *
 * Astro's built-in sitemap only sees pages it builds. We have hundreds of
 * thousands of dynamic pages (review/compare/best-of) — we generate a
 * sitemap directly from the DB and write to /public/sitemap.xml so it's
 * served by Cloudflare Pages.
 *
 * Every dynamic page now exists at /{lang}/... in 4 languages; the sitemap
 * emits one <url> per language with <xhtml:link rel="alternate" hreflang>
 * cross-references so search engines pick the right variant per visitor.
 */

import { db } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";

const log = child("sitemap-builder");

type Lang = "th" | "en" | "zh" | "ja";
const LANGS: readonly Lang[] = ["th", "en", "zh", "ja"] as const;
const X_DEFAULT_LANG: Lang = "en";

interface UrlEntry {
  loc: string;
  lastmod: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
  /** When set, the URL has localized variants — emit hreflang alternates. */
  langVariants?: { lang: Lang; loc: string }[];
}

const SITE = `https://${env.DOMAIN_NAME}`;

const SITEMAP_LIMIT = 50_000; // Google's per-sitemap limit

/**
 * Build a list of UrlEntry, one per language, all linking to each other via langVariants.
 * Used for any URL pattern that has /{lang}/{path} variants.
 */
function localizedEntries(
  pathSuffix: string,
  lastmod: string,
  changefreq: UrlEntry["changefreq"],
  priority: number,
): UrlEntry[] {
  const variants = LANGS.map((lang) => ({ lang, loc: `/${lang}${pathSuffix}` }));
  return variants.map((v) => ({
    loc: v.loc,
    lastmod,
    changefreq,
    priority,
    langVariants: variants,
  }));
}

export async function buildSitemap(opts: { outputDir?: string } = {}): Promise<{
  totalUrls: number;
  files: string[];
}> {
  const outputDir = opts.outputDir ?? path.join(process.cwd(), "src/web/public");
  await mkdir(outputDir, { recursive: true });

  const now = new Date().toISOString();
  const entries: UrlEntry[] = [];

  // Static pages — homepage + about + best, in every language.
  for (const suffix of ["/", "/best", "/about", "/categories"]) {
    entries.push(
      ...localizedEntries(suffix === "/" ? "/" : suffix, now, "daily", suffix === "/" ? 1.0 : 0.7),
    );
  }

  // Pull all published content pages
  const pages = await db.execute<{ slug: string; type: string; updated_at: Date }>(sql`
    SELECT slug, type::text AS type, COALESCE(updated_at, published_at, created_at) AS updated_at
      FROM content_pages
     WHERE status = 'published'
     ORDER BY revenue_30d_satang DESC NULLS LAST, updated_at DESC
  `);

  // Category pages (only those with enough products)
  const categories = await db.execute<{ slug: string }>(sql`
    SELECT c.slug
      FROM categories c
     WHERE c.is_active = true
       AND (SELECT COUNT(*) FROM products p
             WHERE p.category_id = c.id
               AND p.is_active = true) >= 1
  `);

  for (const c of categories) {
    entries.push(...localizedEntries(`/หมวด/${c.slug}`, now, "daily", 0.85));
  }

  for (const p of pages) {
    const suffix =
      p.type === "review"
        ? `/รีวิว/${p.slug}`
        : p.type === "comparison"
          ? `/เปรียบเทียบ/${p.slug}`
          : p.type === "best_of"
            ? `/ของดี/${p.slug}`
            : `/${p.slug}`;

    const lastmod = new Date(p.updated_at).toISOString();
    const changefreq: UrlEntry["changefreq"] =
      p.type === "best_of" ? "weekly" : "monthly";
    const priority =
      p.type === "best_of"
        ? 0.8
        : p.type === "comparison"
          ? 0.7
          : 0.6;

    entries.push(...localizedEntries(suffix, lastmod, changefreq, priority));
  }

  log.info({ totalUrls: entries.length }, "building sitemap");

  // Split into chunks of SITEMAP_LIMIT and create index
  const files: string[] = [];
  if (entries.length <= SITEMAP_LIMIT) {
    const xml = buildSitemapXml(entries);
    const filePath = path.join(outputDir, "sitemap.xml");
    await writeFile(filePath, xml, "utf8");
    files.push("sitemap.xml");
  } else {
    const chunks = Math.ceil(entries.length / SITEMAP_LIMIT);
    const indexEntries: Array<{ loc: string; lastmod: string }> = [];
    for (let i = 0; i < chunks; i++) {
      const slice = entries.slice(i * SITEMAP_LIMIT, (i + 1) * SITEMAP_LIMIT);
      const xml = buildSitemapXml(slice);
      const fileName = `sitemap-${i + 1}.xml`;
      await writeFile(path.join(outputDir, fileName), xml, "utf8");
      files.push(fileName);
      indexEntries.push({
        loc: `${SITE}/${fileName}`,
        lastmod: new Date().toISOString(),
      });
    }
    const indexXml = buildSitemapIndexXml(indexEntries);
    await writeFile(path.join(outputDir, "sitemap-index.xml"), indexXml, "utf8");
    files.push("sitemap-index.xml");
  }

  log.info({ files, totalUrls: entries.length }, "sitemap written");
  return { totalUrls: entries.length, files };
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSitemapXml(entries: UrlEntry[]): string {
  const items = entries
    .map((e) => {
      const alternates = e.langVariants
        ? e.langVariants
            .map(
              (v) =>
                `    <xhtml:link rel="alternate" hreflang="${v.lang}" href="${escapeXml(SITE + v.loc)}"/>`,
            )
            .join("\n") +
          "\n" +
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(
            SITE +
              (e.langVariants.find((v) => v.lang === X_DEFAULT_LANG)?.loc ?? e.langVariants[0]!.loc),
          )}"/>`
        : "";
      return `  <url>
    <loc>${escapeXml(SITE + e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>${alternates ? "\n" + alternates : ""}
  </url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${items}
</urlset>
`;
}

function buildSitemapIndexXml(entries: Array<{ loc: string; lastmod: string }>): string {
  const items = entries
    .map(
      (e) =>
        `  <sitemap>
    <loc>${escapeXml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
  </sitemap>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</sitemapindex>
`;
}

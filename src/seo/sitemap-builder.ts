/**
 * Sitemap builder — generates sitemap.xml from DB content.
 *
 * Astro's built-in sitemap only sees pages it builds. We have hundreds of
 * thousands of dynamic pages (review/compare/best-of) — we generate a
 * sitemap directly from the DB and write to /public/sitemap.xml so it's
 * served by Cloudflare Pages.
 */

import { db } from "../lib/db.ts";
import { sql } from "drizzle-orm";
import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";

const log = child("sitemap-builder");

interface UrlEntry {
  loc: string;
  lastmod: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: number;
}

const SITE = `https://${env.DOMAIN_NAME}`;

const STATIC_PAGES: UrlEntry[] = [
  { loc: "/", lastmod: new Date().toISOString(), changefreq: "daily", priority: 1.0 },
  { loc: "/best", lastmod: new Date().toISOString(), changefreq: "daily", priority: 0.9 },
  { loc: "/about", lastmod: new Date().toISOString(), changefreq: "monthly", priority: 0.3 },
];

const SITEMAP_LIMIT = 50_000; // Google's per-sitemap limit

export async function buildSitemap(opts: { outputDir?: string } = {}): Promise<{
  totalUrls: number;
  files: string[];
}> {
  const outputDir = opts.outputDir ?? path.join(process.cwd(), "src/web/public");
  await mkdir(outputDir, { recursive: true });

  // Pull all published content pages
  const pages = await db.execute<{ slug: string; type: string; updated_at: Date }>(sql`
    SELECT slug, type::text AS type, COALESCE(updated_at, published_at, created_at) AS updated_at
      FROM content_pages
     WHERE status = 'published'
     ORDER BY revenue_30d_satang DESC NULLS LAST, updated_at DESC
  `);

  const entries: UrlEntry[] = [...STATIC_PAGES];

  for (const p of pages) {
    const prefix =
      p.type === "review" ? "/รีวิว/" : p.type === "comparison" ? "/เปรียบเทียบ/" : p.type === "best_of" ? "/ของดี/" : "/";
    entries.push({
      loc: `${prefix}${p.slug}`,
      lastmod: new Date(p.updated_at).toISOString(),
      changefreq: p.type === "best_of" ? "weekly" : "monthly",
      priority: p.type === "best_of" ? 0.8 : p.type === "comparison" ? 0.7 : 0.6,
    });
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
    .map(
      (e) =>
        `  <url>
    <loc>${escapeXml(SITE + e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority.toFixed(1)}</priority>
  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
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

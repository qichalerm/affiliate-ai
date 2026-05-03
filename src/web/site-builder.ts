/**
 * Static site builder — Sprint 19.
 *
 * Reads products + translations from Postgres, emits one HTML file per
 * (page × language) into the configured output directory. Designed to
 * run after every scrape (debounced) so the public site is always in
 * sync with DB state.
 *
 * Output layout (Thai is the default = no prefix):
 *
 *   dist/
 *     index.html              ← TH home
 *     en/index.html
 *     zh/index.html
 *     ja/index.html
 *     p/<slug>.html           ← TH product detail
 *     en/p/<slug>.html
 *     zh/p/<slug>.html
 *     ja/p/<slug>.html
 *     sitemap.xml
 *     robots.txt
 *
 * Deploy: any plain web server pointed at dist/. nginx config docs in
 * the README sprint notes.
 *
 * Performance: writing a few thousand small HTML files is sub-second
 * on local disk. Rebuilds are full-replace (no diffing) — simpler and
 * the dist dir is disposable.
 */

import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "../lib/db.ts";
import { env, can } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { deployToCloudflarePages } from "./deploy-cloudflare.ts";
import {
  renderHomePage,
  renderProductPage,
  renderSitemap,
  renderRobots,
  LANGS,
  type Lang,
  type ProductForRender,
  type SiteConfig,
} from "./templates.ts";

const log = child("web.site-builder");

export interface BuildOptions {
  /** Output directory. Default: ./dist */
  outDir?: string;
  /** Site config (domain + name). */
  config?: Partial<SiteConfig>;
  /** Max products to render on home + as detail pages. Default 200. */
  maxProducts?: number;
  /** Wipe outDir before write. Default true. */
  clean?: boolean;
}

export interface BuildResult {
  outDir: string;
  pagesWritten: number;
  productsRendered: number;
  durationMs: number;
}

const DEFAULT_OUT = process.env.SITE_OUT_DIR ?? "./dist";
const DEFAULT_DOMAIN = process.env.SITE_DOMAIN ?? "price-th.com";
const DEFAULT_NAME = process.env.SITE_NAME ?? "Price-TH Deals";

export async function buildSite(opts: BuildOptions = {}): Promise<BuildResult> {
  const start = Date.now();
  const outDir = opts.outDir ?? DEFAULT_OUT;
  const maxProducts = opts.maxProducts ?? 200;

  // Most-recent scrape time → drives the "Updated 3h ago" indicator
  // shown across the chrome (header/hero trust bar/footer pulse dot).
  const [latestScrape] = await db.execute<{ lastScrapedAt: string; [k: string]: unknown }>(sql`
    SELECT MAX(last_scraped_at) AS "lastScrapedAt" FROM products WHERE is_active = true
  `);

  const config: SiteConfig = {
    domain: opts.config?.domain ?? DEFAULT_DOMAIN,
    name: opts.config?.name ?? DEFAULT_NAME,
    lastUpdatedAt: latestScrape?.lastScrapedAt ?? undefined,
    sources: ["Shopee"],
  };

  log.info({ outDir, maxProducts, domain: config.domain, lastUpdated: config.lastUpdatedAt }, "site build start");

  // Pull eligible products (active, not blacklisted, has price).
  // Sort by final_score desc fallback to first_seen_at desc — best-of first.
  type ProductRow = ProductForRender & Record<string, unknown>;
  const products = await db.execute<ProductRow>(sql`
    SELECT
      id, slug, name, brand, description,
      primary_image AS "primaryImage",
      current_price AS "currentPrice",
      original_price AS "originalPrice",
      discount_percent AS "discountPercent",
      rating, rating_count AS "ratingCount", sold_count AS "soldCount",
      affiliate_short_url AS "affiliateShortUrl",
      translations
    FROM products
    WHERE is_active = true
      AND flag_blacklisted = false
      AND current_price IS NOT NULL
    ORDER BY COALESCE(final_score, 0) DESC NULLS LAST,
             first_seen_at DESC
    LIMIT ${maxProducts}
  `);

  const productList = products as unknown as ProductForRender[];

  // Pre-process products BEFORE any render so home + detail pages
  // agree on the slug (was a bug: safeSlug was applied per-product
  // inside the detail loop, so home cards linked to the un-truncated
  // slug while files were written under the truncated one — every
  // home click landed on a 404 / SPA-fallback to the home page).
  // Also overwrite affiliate_short_url with our own /go/<shortId>
  // tracking URL so the product page CTA actually works.
  for (const p of productList) {
    p.slug = safeSlug(p.slug, p.id);
  }
  await attachWebAffiliateUrls(productList);

  log.info({ products: productList.length }, "products fetched");

  if (opts.clean !== false && existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }

  let pagesWritten = 0;

  // ── Home page in each language ─────────────────────────────────
  for (const lang of LANGS) {
    const html = renderHomePage({ lang, products: productList, config });
    const path = lang === "th"
      ? join(outDir, "index.html")
      : join(outDir, lang, "index.html");
    writeFile(path, html);
    pagesWritten++;
  }

  // ── Product detail pages ───────────────────────────────────────
  for (const product of productList) {
    for (const lang of LANGS) {
      const html = renderProductPage({ lang, product, config });
      const path = lang === "th"
        ? join(outDir, "p", `${product.slug}.html`)
        : join(outDir, lang, "p", `${product.slug}.html`);
      writeFile(path, html);
      pagesWritten++;
    }
  }

  // ── Sitemap + robots ───────────────────────────────────────────
  const sitemap = renderSitemap({
    config,
    productSlugs: productList.map((p) => p.slug),
  });
  writeFile(join(outDir, "sitemap.xml"), sitemap);
  pagesWritten++;

  writeFile(join(outDir, "robots.txt"), renderRobots(config.domain));
  pagesWritten++;

  const result: BuildResult = {
    outDir,
    pagesWritten,
    productsRendered: productList.length,
    durationMs: Date.now() - start,
  };

  log.info(result, "site build done");
  return result;
}

function writeFile(path: string, body: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, body, "utf8");
}

/**
 * Replace each product's `affiliateShortUrl` with our own /go/<shortId>
 * tracking link from affiliate_links (channel='web'). The DB column
 * `products.affiliate_short_url` is reserved for Shopee's own shp.ee/xxx
 * shortener (rarely populated) — the M8 click tracker writes its own
 * row in affiliate_links per product on first scrape. The web CTA needs
 * the latter so clicks attribute back to us, not to Shopee directly.
 */
async function attachWebAffiliateUrls(products: ProductForRender[]): Promise<void> {
  if (products.length === 0) return;
  const ids = products.map((p) => p.id);

  type LinkRow = { productId: number; shortId: string; [k: string]: unknown };
  // Pick the most recent web link per product (ORDER BY id DESC then DISTINCT ON)
  const rows = await db.execute<LinkRow>(sql`
    SELECT DISTINCT ON (product_id)
      product_id AS "productId", short_id AS "shortId"
    FROM affiliate_links
    WHERE channel = 'web' AND product_id = ANY(${sql.raw(`ARRAY[${ids.join(",")}]::int[]`)})
    ORDER BY product_id, id DESC
  `);

  const map = new Map(rows.map((r) => [r.productId, r.shortId]));
  for (const p of products) {
    const shortId = map.get(p.id);
    if (shortId) {
      p.affiliateShortUrl = `https://${env.SITE_DOMAIN}/go/${shortId}`;
    }
  }
}

/**
 * Truncate a slug so filenames stay below the ext4 255-byte limit even
 * after multi-byte UTF-8 (Thai/Chinese/Japanese chars are 3 bytes each).
 *
 * Strategy: take first 40 codepoints (~120 bytes max for 3-byte chars),
 * append "-{id}" to guarantee uniqueness when many products share long
 * prefixes. We don't try to keep the slug "pretty" — SEO impact is
 * negligible since the slug is mostly Thai which Google decodes anyway.
 */
function safeSlug(rawSlug: string, productId: number): string {
  const MAX_CHARS = 40;
  const truncated = [...rawSlug].slice(0, MAX_CHARS).join("");
  return `${truncated}-${productId}`;
}

/* -----------------------------------------------------------------------------
 * Debounced rebuild — call from any module that mutates display data.
 * Coalesces N calls within DEBOUNCE_MS into a single build.
 * ---------------------------------------------------------------------------*/

const DEBOUNCE_MS = Number.parseInt(process.env.SITE_REBUILD_DEBOUNCE_MS ?? "300000", 10);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let queuedBuildResolvers: Array<(r: BuildResult) => void> = [];
let queuedBuildRejectors: Array<(err: unknown) => void> = [];

export function scheduleSiteRebuild(opts: BuildOptions = {}): Promise<BuildResult> {
  return new Promise<BuildResult>((resolve, reject) => {
    queuedBuildResolvers.push(resolve);
    queuedBuildRejectors.push(reject);

    if (debounceTimer) {
      log.debug("rebuild already queued — coalescing");
      return;
    }

    log.info({ debounceMs: DEBOUNCE_MS }, "rebuild scheduled");
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const resolvers = queuedBuildResolvers;
      const rejectors = queuedBuildRejectors;
      queuedBuildResolvers = [];
      queuedBuildRejectors = [];
      try {
        const r = await buildSite(opts);

        // Auto-deploy to Cloudflare Pages if configured. Build success
        // is reported even if deploy fails — local dist/ is still good
        // for a manual `deploy:site` retry.
        if (env.AUTO_DEPLOY_AFTER_REBUILD && can.deployCloudflare()) {
          try {
            const d = await deployToCloudflarePages({
              outDir: r.outDir,
              commitMessage: `auto-rebuild ${r.productsRendered}p ${r.pagesWritten}f`,
            });
            log.info({ url: d.url, alias: d.aliasUrl, deployMs: d.durationMs }, "auto-deploy ok");
          } catch (deployErr) {
            log.error({ err: errMsg(deployErr) }, "auto-deploy failed (build kept)");
          }
        }

        for (const fn of resolvers) fn(r);
      } catch (err) {
        log.error({ err: errMsg(err) }, "scheduled rebuild failed");
        for (const fn of rejectors) fn(err);
      }
    }, DEBOUNCE_MS);
  });
}

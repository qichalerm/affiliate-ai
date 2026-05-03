/**
 * Static-site HTML templates — Sprint 19.
 *
 * Lean, dependency-free templating. Returns full HTML strings for each
 * page type in 4 languages (TH/EN/ZH/JA). Per V2 vision: pre-rendered
 * static HTML, NOT runtime translation — better SEO, no latency, and
 * the site can be served by any plain web server (nginx/Caddy/Pages).
 *
 * Design choices:
 *   - Inline CSS (single critical-path stylesheet, no external requests)
 *   - System fonts only (no Google Fonts — adds ~100ms latency in TH)
 *   - hreflang alternates for cross-language SEO
 *   - Open Graph + canonical for social shares
 *   - JSON-LD Product schema on detail pages (rich results in Google)
 *
 * The translations used here come from products.translations JSONB, so
 * if a product hasn't been translated yet (lang missing), we fall back
 * to the Thai source so SEO never has empty pages.
 */

export type Lang = "th" | "en" | "zh" | "ja";
export const LANGS: Lang[] = ["th", "en", "zh", "ja"];

export interface ProductForRender {
  id: number;
  slug: string;
  name: string;                 // Thai source
  brand: string | null;
  description: string | null;   // Thai source
  primaryImage: string | null;
  currentPrice: number | null;  // satang
  originalPrice: number | null; // satang
  discountPercent: number | null;
  rating: number | null;
  ratingCount: number | null;
  soldCount: number | null;
  affiliateShortUrl: string | null;
  translations: Record<string, { name?: string; description?: string }> | null;
}

export interface SiteConfig {
  /** Public hostname, no scheme: e.g. "price-th.com" */
  domain: string;
  /** Site name shown in nav. */
  name: string;
}

const I18N: Record<Lang, {
  htmlLang: string;
  siteTagline: string;
  hotDeals: string;
  trending: string;
  buyNow: string;
  viewMore: string;
  rating: string;
  sold: string;
  noTranslation: string;
  off: string;
  searchPlaceholder: string;
  footerNote: string;
  baht: string;
  brand: string;
}> = {
  th: {
    htmlLang: "th-TH",
    siteTagline: "รวมดีลคุ้มจาก Shopee + TikTok Shop",
    hotDeals: "ดีลร้อนแรง",
    trending: "กำลังมาแรง",
    buyNow: "ดูราคาบน Shopee",
    viewMore: "ดูเพิ่ม",
    rating: "คะแนน",
    sold: "ขายแล้ว",
    noTranslation: "(ยังไม่ได้แปล)",
    off: "ลด",
    searchPlaceholder: "ค้นหาสินค้า...",
    footerNote: "ราคาอัปเดตอัตโนมัติทุก 6 ชั่วโมง · มี affiliate disclosure",
    baht: "฿",
    brand: "แบรนด์",
  },
  en: {
    htmlLang: "en",
    siteTagline: "Best deals from Shopee + TikTok Shop",
    hotDeals: "Hot Deals",
    trending: "Trending Now",
    buyNow: "View on Shopee",
    viewMore: "View More",
    rating: "Rating",
    sold: "Sold",
    noTranslation: "(translation pending)",
    off: "OFF",
    searchPlaceholder: "Search products...",
    footerNote: "Prices auto-update every 6 hours · Affiliate links",
    baht: "฿",
    brand: "Brand",
  },
  zh: {
    htmlLang: "zh-CN",
    siteTagline: "Shopee + TikTok Shop 精选优惠",
    hotDeals: "热门优惠",
    trending: "正在热销",
    buyNow: "前往 Shopee",
    viewMore: "查看更多",
    rating: "评分",
    sold: "已售",
    noTranslation: "(暂无翻译)",
    off: "折",
    searchPlaceholder: "搜索商品...",
    footerNote: "价格每 6 小时自动更新 · 含联盟链接",
    baht: "฿",
    brand: "品牌",
  },
  ja: {
    htmlLang: "ja",
    siteTagline: "Shopee + TikTok Shop お得な情報",
    hotDeals: "ホットディール",
    trending: "トレンド",
    buyNow: "Shopee で見る",
    viewMore: "もっと見る",
    rating: "評価",
    sold: "販売数",
    noTranslation: "(翻訳準備中)",
    off: "OFF",
    searchPlaceholder: "商品を検索...",
    footerNote: "価格は6時間ごとに自動更新 · アフィリエイトリンク",
    baht: "฿",
    brand: "ブランド",
  },
};

/* -----------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------*/

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBaht(satang: number | null, lang: Lang): string {
  if (satang == null) return "—";
  const baht = satang / 100;
  // Use locale-aware grouping (en gets "1,234"; ja/zh similar; th similar)
  return I18N[lang].baht + baht.toLocaleString(lang === "th" ? "th-TH" : lang === "zh" ? "zh-CN" : lang);
}

function langPrefix(lang: Lang): string {
  return lang === "th" ? "" : `/${lang}`;
}

function pageUrl(lang: Lang, path: string): string {
  return `${langPrefix(lang)}${path}`;
}

function productPath(lang: Lang, slug: string): string {
  return pageUrl(lang, `/p/${slug}`);
}

function localizedProduct(p: ProductForRender, lang: Lang): { name: string; description: string | null } {
  if (lang === "th") return { name: p.name, description: p.description };
  const t = p.translations?.[lang];
  return {
    name: t?.name?.trim() || p.name,
    description: t?.description?.trim() || p.description,
  };
}

/* -----------------------------------------------------------------------------
 * Shared chrome (head + nav + footer)
 * ---------------------------------------------------------------------------*/

function htmlHead(args: {
  lang: Lang;
  title: string;
  description: string;
  canonical: string;
  ogImage: string | null;
  alternates: Array<{ lang: Lang; href: string }>;
  jsonLd?: string;
  domain: string;
}): string {
  const i = I18N[args.lang];
  const fullCanonical = `https://${args.domain}${args.canonical}`;

  const alts = args.alternates
    .map((a) => `<link rel="alternate" hreflang="${I18N[a.lang].htmlLang}" href="https://${args.domain}${a.href}">`)
    .join("\n  ");

  const og = args.ogImage
    ? `<meta property="og:image" content="${escapeHtml(args.ogImage)}">`
    : "";

  const ld = args.jsonLd
    ? `<script type="application/ld+json">${args.jsonLd}</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="${i.htmlLang}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(args.title)}</title>
  <meta name="description" content="${escapeHtml(args.description)}">
  <link rel="canonical" href="${fullCanonical}">
  ${alts}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${escapeHtml(args.title)}">
  <meta property="og:description" content="${escapeHtml(args.description)}">
  <meta property="og:url" content="${fullCanonical}">
  <meta property="og:locale" content="${i.htmlLang.replace("-", "_")}">
  ${og}
  <meta name="twitter:card" content="summary_large_image">
  ${ld}
  <style>${BASE_CSS}</style>
</head>`;
}

const BASE_CSS = `
:root {
  --bg: #ffffff; --fg: #1a1a1a; --muted: #6b6b6b;
  --accent: #e8423b; --accent-fg: #ffffff;
  --card-bg: #ffffff; --card-border: #e6e6e6;
  --bg-soft: #f7f7f7;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131316; --fg: #f0f0f0; --muted: #9b9b9b;
    --accent: #ff6b63; --accent-fg: #ffffff;
    --card-bg: #1d1d22; --card-border: #2c2c33;
    --bg-soft: #1a1a1f;
  }
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", "Noto Sans Thai", sans-serif;
       background: var(--bg); color: var(--fg); line-height: 1.5; }
header { padding: 1rem 1.5rem; border-bottom: 1px solid var(--card-border);
         display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: .5rem; }
header h1 { margin: 0; font-size: 1.25rem; }
header h1 a { color: inherit; text-decoration: none; }
nav.langs a { margin-left: .5rem; padding: .25rem .5rem; border-radius: 4px;
              text-decoration: none; color: var(--muted); font-size: .9rem; }
nav.langs a.active { background: var(--accent); color: var(--accent-fg); }
main { max-width: 1200px; margin: 0 auto; padding: 1.5rem; }
h2 { font-size: 1.5rem; margin: 0 0 1rem 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 8px;
        overflow: hidden; transition: transform .15s ease; }
.card:hover { transform: translateY(-2px); }
.card a.cardlink { text-decoration: none; color: inherit; display: block; }
.card .img { aspect-ratio: 1; background: var(--bg-soft); position: relative; overflow: hidden; }
.card .img img { width: 100%; height: 100%; object-fit: cover; display: block; }
.badge { position: absolute; top: .5rem; left: .5rem; background: var(--accent);
         color: var(--accent-fg); padding: .25rem .5rem; border-radius: 4px; font-size: .75rem; font-weight: 600; }
.card .body { padding: .75rem; }
.card h3 { margin: 0 0 .5rem 0; font-size: .95rem; line-height: 1.3;
           display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.price { font-weight: 700; color: var(--accent); font-size: 1.05rem; }
.price-old { color: var(--muted); text-decoration: line-through; font-size: .85rem; margin-left: .5rem; }
.meta { display: flex; gap: .75rem; color: var(--muted); font-size: .8rem; margin-top: .25rem; }
.detail { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
@media (max-width: 700px) { .detail { grid-template-columns: 1fr; } }
.detail .info h2 { font-size: 1.5rem; line-height: 1.3; }
.cta { display: inline-block; background: var(--accent); color: var(--accent-fg);
       padding: .75rem 1.5rem; border-radius: 6px; text-decoration: none;
       font-weight: 600; margin-top: 1rem; }
.cta:hover { opacity: .9; }
.spec { margin: 1rem 0; padding: .75rem 1rem; background: var(--bg-soft); border-radius: 6px;
        font-size: .9rem; }
.spec dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .25rem 1rem; }
.spec dt { color: var(--muted); }
footer { border-top: 1px solid var(--card-border); padding: 1.5rem;
         color: var(--muted); font-size: .85rem; text-align: center; }
.disclosure { background: var(--bg-soft); padding: .75rem; border-radius: 6px;
              font-size: .85rem; color: var(--muted); margin-top: 1rem; }
`;

function navHeader(currentLang: Lang, currentPath: string, alternates: Array<{ lang: Lang; href: string }>, siteName: string): string {
  const langLinks = alternates
    .map((a) => `<a href="${a.href}" hreflang="${I18N[a.lang].htmlLang}"${a.lang === currentLang ? ' class="active"' : ""}>${a.lang.toUpperCase()}</a>`)
    .join("");
  return `<header>
  <h1><a href="${pageUrl(currentLang, "/")}">${escapeHtml(siteName)}</a></h1>
  <nav class="langs">${langLinks}</nav>
</header>`;
}

function footer(lang: Lang): string {
  return `<footer>${escapeHtml(I18N[lang].footerNote)}</footer>`;
}

/* -----------------------------------------------------------------------------
 * Page builders
 * ---------------------------------------------------------------------------*/

function productCard(p: ProductForRender, lang: Lang): string {
  const { name } = localizedProduct(p, lang);
  const img = p.primaryImage ?? "";
  const discount = p.discountPercent && p.discountPercent > 0
    ? `<div class="badge">${Math.round(p.discountPercent * 100)}% ${I18N[lang].off}</div>`
    : "";
  const original = p.originalPrice && p.originalPrice > (p.currentPrice ?? 0)
    ? `<span class="price-old">${formatBaht(p.originalPrice, lang)}</span>` : "";
  const ratingHtml = p.rating
    ? `<span>★ ${p.rating.toFixed(1)}${p.ratingCount ? ` (${p.ratingCount.toLocaleString()})` : ""}</span>` : "";
  const soldHtml = p.soldCount
    ? `<span>${I18N[lang].sold} ${p.soldCount.toLocaleString()}</span>` : "";

  return `<article class="card">
  <a href="${productPath(lang, p.slug)}" class="cardlink">
    <div class="img">${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" loading="lazy">` : ""}${discount}</div>
    <div class="body">
      <h3>${escapeHtml(name)}</h3>
      <div><span class="price">${formatBaht(p.currentPrice, lang)}</span>${original}</div>
      <div class="meta">${ratingHtml}${soldHtml}</div>
    </div>
  </a>
</article>`;
}

export function renderHomePage(args: {
  lang: Lang;
  products: ProductForRender[];
  config: SiteConfig;
}): string {
  const i = I18N[args.lang];
  const path = pageUrl(args.lang, "/");
  const alternates = LANGS.map((l) => ({ lang: l, href: pageUrl(l, "/") }));

  const head = htmlHead({
    lang: args.lang,
    title: `${args.config.name} — ${i.siteTagline}`,
    description: i.siteTagline,
    canonical: path,
    ogImage: args.products[0]?.primaryImage ?? null,
    alternates,
    domain: args.config.domain,
  });

  const cards = args.products.slice(0, 24).map((p) => productCard(p, args.lang)).join("\n");

  return `${head}
<body>
${navHeader(args.lang, path, alternates, args.config.name)}
<main>
  <h2>${i.hotDeals}</h2>
  <div class="grid">${cards}</div>
</main>
${footer(args.lang)}
</body>
</html>`;
}

export function renderProductPage(args: {
  lang: Lang;
  product: ProductForRender;
  config: SiteConfig;
}): string {
  const i = I18N[args.lang];
  const { name, description } = localizedProduct(args.product, args.lang);
  const path = productPath(args.lang, args.product.slug);
  const alternates = LANGS.map((l) => ({ lang: l, href: productPath(l, args.product.slug) }));

  // JSON-LD Product schema for rich results
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name,
    description: description ?? "",
    image: args.product.primaryImage ?? undefined,
    brand: args.product.brand ? { "@type": "Brand", name: args.product.brand } : undefined,
    offers: args.product.currentPrice != null ? {
      "@type": "Offer",
      priceCurrency: "THB",
      price: (args.product.currentPrice / 100).toFixed(2),
      availability: "https://schema.org/InStock",
      url: args.product.affiliateShortUrl ?? undefined,
    } : undefined,
    aggregateRating: args.product.rating && args.product.ratingCount ? {
      "@type": "AggregateRating",
      ratingValue: args.product.rating,
      reviewCount: args.product.ratingCount,
    } : undefined,
  }, null, 0);

  const head = htmlHead({
    lang: args.lang,
    title: `${name} — ${args.config.name}`,
    description: description?.slice(0, 160) ?? i.siteTagline,
    canonical: path,
    ogImage: args.product.primaryImage,
    alternates,
    jsonLd,
    domain: args.config.domain,
  });

  const img = args.product.primaryImage
    ? `<img src="${escapeHtml(args.product.primaryImage)}" alt="${escapeHtml(name)}">`
    : "";
  const original = args.product.originalPrice && args.product.originalPrice > (args.product.currentPrice ?? 0)
    ? `<span class="price-old">${formatBaht(args.product.originalPrice, args.lang)}</span>` : "";
  const discount = args.product.discountPercent && args.product.discountPercent > 0
    ? `<span class="badge" style="position:static; margin-left:.5rem;">${Math.round(args.product.discountPercent * 100)}% ${i.off}</span>` : "";
  const ratingDt = args.product.rating
    ? `<dt>${i.rating}</dt><dd>★ ${args.product.rating.toFixed(1)}${args.product.ratingCount ? ` (${args.product.ratingCount.toLocaleString()})` : ""}</dd>` : "";
  const soldDt = args.product.soldCount
    ? `<dt>${i.sold}</dt><dd>${args.product.soldCount.toLocaleString()}</dd>` : "";
  const brandDt = args.product.brand ? `<dt>${i.brand}</dt><dd>${escapeHtml(args.product.brand)}</dd>` : "";

  const cta = args.product.affiliateShortUrl
    ? `<a href="${escapeHtml(args.product.affiliateShortUrl)}" class="cta" rel="sponsored nofollow noopener" target="_blank">${i.buyNow}</a>`
    : "";

  return `${head}
<body>
${navHeader(args.lang, path, alternates, args.config.name)}
<main>
  <article class="detail">
    <div class="img card">${img}</div>
    <div class="info">
      <h2>${escapeHtml(name)}</h2>
      <div><span class="price" style="font-size:1.5rem;">${formatBaht(args.product.currentPrice, args.lang)}</span>${original}${discount}</div>
      <div class="spec"><dl>${brandDt}${ratingDt}${soldDt}</dl></div>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${cta}
      <p class="disclosure">${escapeHtml(i.footerNote)}</p>
    </div>
  </article>
</main>
${footer(args.lang)}
</body>
</html>`;
}

export function renderSitemap(args: {
  config: SiteConfig;
  productSlugs: string[];
}): string {
  const urls: string[] = [];
  // Home in each language
  for (const lang of LANGS) {
    urls.push(`https://${args.config.domain}${pageUrl(lang, "/")}`);
  }
  // Each product in each language
  for (const slug of args.productSlugs) {
    for (const lang of LANGS) {
      urls.push(`https://${args.config.domain}${productPath(lang, slug)}`);
    }
  }
  const lastmod = new Date().toISOString();
  const xml = urls.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xml}
</urlset>`;
}

export function renderRobots(domain: string): string {
  return `User-agent: *
Allow: /
Sitemap: https://${domain}/sitemap.xml
`;
}

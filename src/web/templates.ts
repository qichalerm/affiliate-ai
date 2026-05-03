/**
 * Static-site HTML templates — Sprint 22 redesign.
 *
 * Pre-rendered HTML in 4 languages (TH/EN/ZH/JA). Per V2 vision: static
 * HTML beats runtime translation for SEO + edge latency. Falls back to
 * Thai source when a target translation is missing so pages never ship
 * empty content.
 *
 * Visual playbook (informed by ShopBack TH, Slickdeals, Priceza,
 * hotukdeals research):
 *   - One bold accent on white (#FF5722 coral for prices/CTAs/badges)
 *   - Sticky compact header with prominent search slot
 *   - Circular discount badge top-left of every card
 *   - Strikethrough original + oversized bold sale price
 *   - Source chip (Shopee / TikTok Shop) below title
 *   - Trust-stat strip below hero
 *   - Star rating + review count line
 *   - Airy grid (24-32px gaps), dense card interior
 *   - Mobile: 2 cols, sticky header shrinks
 *
 * Pure HTML+CSS — no JS framework (V2 vision: SSG-only).
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
  /** ISO timestamp of latest data refresh (rendered as "Updated 3h ago"). */
  lastUpdatedAt?: string;
  /** Source platforms shown in trust bar. */
  sources?: string[];
}

const I18N: Record<Lang, {
  htmlLang: string;
  siteTagline: string;
  siteHeadline: string;
  siteSubhead: string;
  hotDeals: string;
  trustProducts: string;
  trustSources: string;
  trustUpdated: string;
  trustLangs: string;
  buyNow: string;
  rating: string;
  sold: string;
  off: string;
  searchPlaceholder: string;
  brand: string;
  source: string;
  disclosure: string;
  footerAbout: string;
  footerSourcesLabel: string;
  updatedJustNow: string;
  updatedMinutes: (n: number) => string;
  updatedHours: (n: number) => string;
  updatedDays: (n: number) => string;
}> = {
  th: {
    htmlLang: "th-TH",
    siteTagline: "รวมดีลคุ้มสุดจาก Shopee + TikTok Shop ทุกวัน",
    siteHeadline: "ดีลคุ้มที่สุด ราคาดีที่สุด อัปเดตอัตโนมัติ",
    siteSubhead: "เปรียบเทียบราคาจาก Shopee และ TikTok Shop รวบรวมโดย AI ทุก 6 ชั่วโมง",
    hotDeals: "ดีลร้อนแรง",
    trustProducts: "สินค้าคัดสรร",
    trustSources: "ร้านค้า",
    trustUpdated: "อัปเดตล่าสุด",
    trustLangs: "4 ภาษา",
    buyNow: "ดูราคาบน Shopee",
    rating: "คะแนน",
    sold: "ขายแล้ว",
    off: "ลด",
    searchPlaceholder: "ค้นหาสินค้า...",
    brand: "แบรนด์",
    source: "แหล่งที่มา",
    disclosure: "ลิงก์บนเว็บนี้เป็น affiliate links — เราอาจได้รับค่าคอมมิชชั่นเมื่อคุณซื้อผ่านลิงก์โดยไม่มีค่าใช้จ่ายเพิ่ม",
    footerAbout: "เกี่ยวกับเรา",
    footerSourcesLabel: "แหล่งข้อมูล",
    updatedJustNow: "เพิ่งอัปเดต",
    updatedMinutes: (n) => `อัปเดต ${n} นาทีที่แล้ว`,
    updatedHours: (n) => `อัปเดต ${n} ชั่วโมงที่แล้ว`,
    updatedDays: (n) => `อัปเดต ${n} วันที่แล้ว`,
  },
  en: {
    htmlLang: "en",
    siteTagline: "Best deals from Shopee + TikTok Shop, refreshed daily",
    siteHeadline: "Best deals. Best prices. Auto-updated.",
    siteSubhead: "Real-time price comparison from Shopee and TikTok Shop, curated by AI every 6 hours",
    hotDeals: "Hot Deals",
    trustProducts: "Curated Products",
    trustSources: "Stores",
    trustUpdated: "Last Updated",
    trustLangs: "4 Languages",
    buyNow: "View on Shopee",
    rating: "Rating",
    sold: "Sold",
    off: "OFF",
    searchPlaceholder: "Search products...",
    brand: "Brand",
    source: "Source",
    disclosure: "Links on this site are affiliate links — we may earn a commission when you purchase, at no extra cost to you.",
    footerAbout: "About",
    footerSourcesLabel: "Sources",
    updatedJustNow: "Just updated",
    updatedMinutes: (n) => `Updated ${n}m ago`,
    updatedHours: (n) => `Updated ${n}h ago`,
    updatedDays: (n) => `Updated ${n}d ago`,
  },
  zh: {
    htmlLang: "zh-CN",
    siteTagline: "Shopee + TikTok Shop 每日精选优惠",
    siteHeadline: "最优惠的价格，自动每日更新",
    siteSubhead: "实时比价 Shopee 和 TikTok Shop，AI 每 6 小时精选",
    hotDeals: "热门优惠",
    trustProducts: "精选商品",
    trustSources: "店铺",
    trustUpdated: "最近更新",
    trustLangs: "4 种语言",
    buyNow: "前往 Shopee",
    rating: "评分",
    sold: "已售",
    off: "折",
    searchPlaceholder: "搜索商品...",
    brand: "品牌",
    source: "来源",
    disclosure: "本站链接为联盟链接 — 通过链接购买我们可能获得佣金，您无需支付额外费用。",
    footerAbout: "关于我们",
    footerSourcesLabel: "数据来源",
    updatedJustNow: "刚刚更新",
    updatedMinutes: (n) => `${n} 分钟前更新`,
    updatedHours: (n) => `${n} 小时前更新`,
    updatedDays: (n) => `${n} 天前更新`,
  },
  ja: {
    htmlLang: "ja",
    siteTagline: "Shopee + TikTok Shop の毎日のお得情報",
    siteHeadline: "最安値、自動更新、毎日お届け",
    siteSubhead: "Shopee と TikTok Shop のリアルタイム価格比較、AI が 6 時間ごとに厳選",
    hotDeals: "ホットディール",
    trustProducts: "厳選商品",
    trustSources: "ストア",
    trustUpdated: "最終更新",
    trustLangs: "4 言語対応",
    buyNow: "Shopee で見る",
    rating: "評価",
    sold: "販売数",
    off: "OFF",
    searchPlaceholder: "商品を検索...",
    brand: "ブランド",
    source: "出典",
    disclosure: "本サイトのリンクはアフィリエイトリンクです — 購入時に手数料を受け取る場合がありますが、追加料金は一切ありません。",
    footerAbout: "サイトについて",
    footerSourcesLabel: "データソース",
    updatedJustNow: "更新したばかり",
    updatedMinutes: (n) => `${n} 分前に更新`,
    updatedHours: (n) => `${n} 時間前に更新`,
    updatedDays: (n) => `${n} 日前に更新`,
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
  const baht = Math.round(satang / 100);
  const locale = lang === "th" ? "th-TH" : lang === "zh" ? "zh-CN" : lang;
  return "฿" + baht.toLocaleString(locale);
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

function relativeTime(iso: string | undefined, lang: Lang): string {
  if (!iso) return I18N[lang].updatedJustNow;
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return I18N[lang].updatedJustNow;
  if (mins < 60) return I18N[lang].updatedMinutes(mins);
  const hours = Math.round(mins / 60);
  if (hours < 24) return I18N[lang].updatedHours(hours);
  const days = Math.round(hours / 24);
  return I18N[lang].updatedDays(days);
}

function abbreviateCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

/* -----------------------------------------------------------------------------
 * Shared chrome
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#FF5722">
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
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
  ${ld}
  <style>${BASE_CSS}</style>
</head>`;
}

const BASE_CSS = `
:root {
  --bg: #FFFFFF;
  --bg-soft: #F8F9FB;
  --bg-elevated: #FFFFFF;
  --fg: #111827;
  --fg-muted: #6B7280;
  --fg-subtle: #9CA3AF;
  --accent: #FF5722;
  --accent-dark: #E64A19;
  --accent-soft: #FFE5DC;
  --success: #10B981;
  --warn: #F59E0B;
  --border: #E5E7EB;
  --border-soft: #F3F4F6;
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.04);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.08), 0 4px 6px -4px rgb(0 0 0 / 0.05);
  --radius-sm: 6px;
  --radius: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0F1115;
    --bg-soft: #16181F;
    --bg-elevated: #1B1E27;
    --fg: #F3F4F6;
    --fg-muted: #9CA3AF;
    --fg-subtle: #6B7280;
    --accent: #FF6E40;
    --accent-dark: #FF8A65;
    --accent-soft: #3A1F18;
    --border: #2A2D38;
    --border-soft: #1F222B;
    --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.3);
    --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.4);
    --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.5);
  }
}

* { box-sizing: border-box; margin: 0; padding: 0; }

html { scroll-behavior: smooth; }

body {
  font-family: "Noto Sans Thai", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  background: var(--bg);
  color: var(--fg);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: "ss01", "cv11";
}

a { color: inherit; text-decoration: none; }
img { display: block; max-width: 100%; }

/* ── Header ──────────────────────────────────────────────────────── */
.site-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(255,255,255,0.85);
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  border-bottom: 1px solid var(--border-soft);
}
@media (prefers-color-scheme: dark) {
  .site-header { background: rgba(15,17,21,0.85); }
}

.site-header-inner {
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px 24px;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 24px;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.02em;
}
.brand-mark {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--accent), var(--accent-dark));
  display: grid;
  place-items: center;
  color: white;
  font-weight: 800;
  font-size: 14px;
  box-shadow: var(--shadow-sm);
}
.brand-name { color: var(--fg); }

.search-slot {
  position: relative;
  max-width: 480px;
  width: 100%;
  justify-self: center;
}
.search-slot input {
  width: 100%;
  height: 40px;
  padding: 0 14px 0 40px;
  border: 1px solid var(--border);
  background: var(--bg-soft);
  border-radius: var(--radius-pill);
  font-family: inherit;
  font-size: 14px;
  color: var(--fg);
  transition: border-color .15s, background .15s;
}
.search-slot input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg);
}
.search-slot::before {
  content: "";
  position: absolute;
  left: 14px;
  top: 50%;
  width: 16px;
  height: 16px;
  transform: translateY(-50%);
  background: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236B7280'><path fill-rule='evenodd' d='M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z' clip-rule='evenodd'/></svg>") center/contain no-repeat;
  opacity: .6;
}

.lang-switch {
  display: flex;
  gap: 2px;
  background: var(--bg-soft);
  border-radius: var(--radius-pill);
  padding: 4px;
}
.lang-switch a {
  padding: 6px 12px;
  border-radius: var(--radius-pill);
  font-size: 13px;
  font-weight: 600;
  color: var(--fg-muted);
  transition: background .15s, color .15s;
}
.lang-switch a:hover { color: var(--fg); }
.lang-switch a.active {
  background: var(--bg);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}

@media (max-width: 720px) {
  .site-header-inner { grid-template-columns: auto 1fr; gap: 12px; padding: 10px 16px; }
  .search-slot { display: none; }
  .lang-switch { padding: 3px; }
  .lang-switch a { padding: 4px 8px; font-size: 11px; }
  .brand-name { font-size: 16px; }
}

/* ── Hero ──────────────────────────────────────────────────────── */
.hero {
  background: linear-gradient(180deg, var(--bg-soft) 0%, var(--bg) 100%);
  padding: 56px 24px 40px;
  text-align: center;
  border-bottom: 1px solid var(--border-soft);
}
.hero-inner {
  max-width: 800px;
  margin: 0 auto;
}
.hero h1 {
  font-size: clamp(28px, 4.5vw, 44px);
  font-weight: 800;
  line-height: 1.15;
  letter-spacing: -0.025em;
  color: var(--fg);
  margin-bottom: 12px;
}
.hero h1 .hi {
  background: linear-gradient(135deg, var(--accent), var(--accent-dark));
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}
.hero p {
  font-size: clamp(15px, 1.6vw, 18px);
  color: var(--fg-muted);
  margin-bottom: 32px;
}

/* ── Trust bar ──────────────────────────────────────────────────── */
.trust-bar {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  max-width: 720px;
  margin: 0 auto;
  padding-top: 8px;
}
.trust-stat {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px 12px;
  text-align: center;
}
.trust-stat-num {
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -0.02em;
  font-feature-settings: "tnum";
  line-height: 1.1;
}
.trust-stat-label {
  font-size: 11px;
  color: var(--fg-muted);
  margin-top: 4px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 720px) {
  .hero { padding: 36px 16px 28px; }
  .trust-bar { grid-template-columns: repeat(2, 1fr); }
}

/* ── Main content ──────────────────────────────────────────────── */
main {
  max-width: 1280px;
  margin: 0 auto;
  padding: 40px 24px 80px;
}
@media (max-width: 720px) {
  main { padding: 24px 16px 40px; }
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 24px;
  gap: 16px;
}
.section-head h2 {
  font-size: clamp(20px, 2.4vw, 26px);
  font-weight: 700;
  letter-spacing: -0.02em;
}
.section-head .meta {
  font-size: 13px;
  color: var(--fg-muted);
}

/* ── Product grid ──────────────────────────────────────────────── */
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}
@media (max-width: 720px) {
  .product-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
  }
}

.card {
  position: relative;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
  overflow: hidden;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s;
  display: flex;
  flex-direction: column;
}
.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-md);
  border-color: var(--border);
}
.card a.cardlink {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.card-img {
  position: relative;
  aspect-ratio: 1;
  background: var(--bg-soft);
  overflow: hidden;
}
.card-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform .35s ease;
}
.card:hover .card-img img { transform: scale(1.04); }

.discount-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: var(--accent);
  color: #fff;
  font-weight: 800;
  font-size: 13px;
  padding: 6px 10px;
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
  letter-spacing: -0.01em;
  font-feature-settings: "tnum";
}

.source-chip {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(255,255,255,.92);
  color: #111827;
  font-weight: 600;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-pill);
  box-shadow: var(--shadow-sm);
  text-transform: uppercase;
  letter-spacing: .04em;
}

.card-body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.card-brand {
  font-size: 11px;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: .05em;
  font-weight: 600;
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--fg);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 38px;
}

.price-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}
.price {
  font-size: 20px;
  font-weight: 800;
  color: var(--accent);
  letter-spacing: -0.02em;
  font-feature-settings: "tnum";
}
.price-old {
  color: var(--fg-subtle);
  text-decoration: line-through;
  font-size: 13px;
  font-feature-settings: "tnum";
}

.card-meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--fg-muted);
  margin-top: auto;
  padding-top: 6px;
}
.card-meta .star { color: var(--warn); }
.card-meta span { display: inline-flex; align-items: center; gap: 4px; }

/* ── Product detail ────────────────────────────────────────────── */
.detail-wrap {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 48px;
  align-items: start;
}
@media (max-width: 900px) {
  .detail-wrap { grid-template-columns: 1fr; gap: 24px; }
}

.detail-img {
  position: sticky;
  top: 80px;
  background: var(--bg-soft);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--border-soft);
}
.detail-img img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
}
@media (max-width: 900px) {
  .detail-img { position: static; }
}

.detail-info h1 {
  font-size: clamp(22px, 2.8vw, 30px);
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: -0.02em;
  margin-bottom: 12px;
}
.detail-brand {
  font-size: 12px;
  color: var(--fg-subtle);
  text-transform: uppercase;
  letter-spacing: .06em;
  font-weight: 600;
  margin-bottom: 4px;
}

.detail-price-row {
  display: flex;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
  margin: 16px 0 8px;
}
.detail-price-row .price { font-size: 36px; }
.detail-price-row .price-old { font-size: 18px; }
.detail-price-row .badge-pill {
  background: var(--accent-soft);
  color: var(--accent-dark);
  font-weight: 700;
  font-size: 13px;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  letter-spacing: -0.01em;
}

.detail-meta {
  display: flex;
  gap: 20px;
  margin: 16px 0 24px;
  flex-wrap: wrap;
  font-size: 14px;
  color: var(--fg-muted);
}
.detail-meta .star { color: var(--warn); font-weight: 600; }

.detail-cta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--accent);
  color: #fff;
  padding: 14px 28px;
  border-radius: var(--radius);
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.01em;
  transition: background .15s, transform .1s;
  box-shadow: var(--shadow-md);
  width: 100%;
  max-width: 320px;
}
.detail-cta:hover { background: var(--accent-dark); transform: translateY(-1px); }
.detail-cta:active { transform: translateY(0); }
.detail-cta::after {
  content: "→";
  font-weight: 800;
}

.detail-spec {
  margin-top: 24px;
  padding: 16px 18px;
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius);
}
.detail-spec dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 8px 24px;
  font-size: 14px;
}
.detail-spec dt { color: var(--fg-muted); font-weight: 500; }
.detail-spec dd { color: var(--fg); font-weight: 600; }

.detail-desc {
  margin-top: 24px;
  font-size: 15px;
  color: var(--fg);
  line-height: 1.7;
}

.disclosure-note {
  margin-top: 32px;
  padding: 14px 16px;
  background: var(--bg-soft);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  font-size: 13px;
  color: var(--fg-muted);
  line-height: 1.6;
}

/* Mobile sticky CTA */
@media (max-width: 900px) {
  .detail-cta-wrap {
    position: sticky;
    bottom: 16px;
    z-index: 30;
    margin-top: 24px;
  }
  .detail-cta {
    box-shadow: 0 -4px 24px rgba(0,0,0,.12), var(--shadow-md);
    max-width: none;
  }
}

/* ── Footer ────────────────────────────────────────────────────── */
.site-footer {
  border-top: 1px solid var(--border-soft);
  background: var(--bg-soft);
  padding: 32px 24px;
  margin-top: 60px;
}
.footer-inner {
  max-width: 1280px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  text-align: center;
  font-size: 13px;
  color: var(--fg-muted);
}
.footer-inner .brand { justify-content: center; }
.footer-inner .updated {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
}
.footer-inner .pulse {
  width: 8px;
  height: 8px;
  background: var(--success);
  border-radius: 50%;
  box-shadow: 0 0 0 0 rgba(16, 185, 129, .5);
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, .5); }
  70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); }
  100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
}
.footer-inner .small {
  max-width: 600px;
  font-size: 12px;
  color: var(--fg-subtle);
  line-height: 1.6;
}
`;

function siteHeader(currentLang: Lang, currentPath: string, alternates: Array<{ lang: Lang; href: string }>, siteName: string): string {
  const i = I18N[currentLang];
  const langLinks = alternates
    .map((a) => `<a href="${a.href}" hreflang="${I18N[a.lang].htmlLang}"${a.lang === currentLang ? ' class="active"' : ""}>${a.lang.toUpperCase()}</a>`)
    .join("");
  return `<header class="site-header">
  <div class="site-header-inner">
    <a href="${pageUrl(currentLang, "/")}" class="brand">
      <span class="brand-mark">P</span>
      <span class="brand-name">${escapeHtml(siteName)}</span>
    </a>
    <div class="search-slot">
      <input type="search" placeholder="${escapeHtml(i.searchPlaceholder)}" aria-label="${escapeHtml(i.searchPlaceholder)}" disabled>
    </div>
    <nav class="lang-switch" aria-label="Language">${langLinks}</nav>
  </div>
</header>`;
}

function siteFooter(lang: Lang, config: SiteConfig): string {
  const i = I18N[lang];
  const updated = relativeTime(config.lastUpdatedAt, lang);
  const sources = (config.sources ?? ["Shopee", "TikTok Shop"]).join(" · ");
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div class="brand">
      <span class="brand-mark">P</span>
      <span class="brand-name">${escapeHtml(config.name)}</span>
    </div>
    <div class="updated"><span class="pulse"></span>${escapeHtml(updated)}</div>
    <div>${escapeHtml(i.footerSourcesLabel)}: ${escapeHtml(sources)}</div>
    <div class="small">${escapeHtml(i.disclosure)}</div>
  </div>
</footer>`;
}

function trustBar(lang: Lang, config: SiteConfig, productCount: number, sourceCount: number): string {
  const i = I18N[lang];
  const updated = relativeTime(config.lastUpdatedAt, lang);
  return `<div class="trust-bar">
    <div class="trust-stat">
      <div class="trust-stat-num">${abbreviateCount(productCount)}+</div>
      <div class="trust-stat-label">${escapeHtml(i.trustProducts)}</div>
    </div>
    <div class="trust-stat">
      <div class="trust-stat-num">${sourceCount}</div>
      <div class="trust-stat-label">${escapeHtml(i.trustSources)}</div>
    </div>
    <div class="trust-stat">
      <div class="trust-stat-num">6h</div>
      <div class="trust-stat-label">${escapeHtml(i.trustUpdated)}: ${escapeHtml(updated)}</div>
    </div>
    <div class="trust-stat">
      <div class="trust-stat-num">4</div>
      <div class="trust-stat-label">${escapeHtml(i.trustLangs)}</div>
    </div>
  </div>`;
}

/* -----------------------------------------------------------------------------
 * Page builders
 * ---------------------------------------------------------------------------*/

function productCard(p: ProductForRender, lang: Lang): string {
  const i = I18N[lang];
  const { name } = localizedProduct(p, lang);
  const img = p.primaryImage ?? "";
  const discountPct = p.discountPercent && p.discountPercent > 0 ? Math.round(p.discountPercent * 100) : 0;
  const discountBadge = discountPct > 0
    ? `<div class="discount-badge">-${discountPct}%</div>`
    : "";
  const sourceBadge = `<div class="source-chip">Shopee</div>`;
  const original = p.originalPrice && p.originalPrice > (p.currentPrice ?? 0)
    ? `<span class="price-old">${formatBaht(p.originalPrice, lang)}</span>` : "";
  const ratingHtml = p.rating
    ? `<span><span class="star">★</span> ${p.rating.toFixed(1)}${p.ratingCount ? `&nbsp;<span style="opacity:.6">(${abbreviateCount(p.ratingCount)})</span>` : ""}</span>` : "";
  const soldHtml = p.soldCount
    ? `<span>${escapeHtml(i.sold)} ${abbreviateCount(p.soldCount)}</span>` : "";
  const brand = p.brand ? `<div class="card-brand">${escapeHtml(p.brand)}</div>` : "";

  return `<article class="card">
  <a href="${productPath(lang, p.slug)}" class="cardlink">
    <div class="card-img">
      ${img ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" loading="lazy">` : ""}
      ${discountBadge}
      ${sourceBadge}
    </div>
    <div class="card-body">
      ${brand}
      <h3 class="card-title">${escapeHtml(name)}</h3>
      <div class="price-row">
        <span class="price">${formatBaht(p.currentPrice, lang)}</span>
        ${original}
      </div>
      <div class="card-meta">${ratingHtml}${soldHtml}</div>
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
    description: i.siteSubhead,
    canonical: path,
    ogImage: args.products[0]?.primaryImage ?? null,
    alternates,
    domain: args.config.domain,
  });

  const cards = args.products.slice(0, 36).map((p) => productCard(p, args.lang)).join("\n");
  const tb = trustBar(args.lang, args.config, args.products.length, 1);
  const totalCount = args.products.length;

  return `${head}
<body>
${siteHeader(args.lang, path, alternates, args.config.name)}
<section class="hero">
  <div class="hero-inner">
    <h1>${escapeHtml(i.siteHeadline.split(" ").slice(0, -1).join(" "))} <span class="hi">${escapeHtml(i.siteHeadline.split(" ").pop() ?? "")}</span></h1>
    <p>${escapeHtml(i.siteSubhead)}</p>
  </div>
  ${tb}
</section>
<main>
  <div class="section-head">
    <h2>${escapeHtml(i.hotDeals)}</h2>
    <span class="meta">${escapeHtml(String(totalCount))} ${escapeHtml(i.trustProducts)}</span>
  </div>
  <div class="product-grid">${cards}</div>
</main>
${siteFooter(args.lang, args.config)}
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
    description: description?.slice(0, 160) ?? i.siteSubhead,
    canonical: path,
    ogImage: args.product.primaryImage,
    alternates,
    jsonLd,
    domain: args.config.domain,
  });

  const img = args.product.primaryImage
    ? `<img src="${escapeHtml(args.product.primaryImage)}" alt="${escapeHtml(name)}" loading="eager">`
    : "";
  const original = args.product.originalPrice && args.product.originalPrice > (args.product.currentPrice ?? 0)
    ? `<span class="price-old">${formatBaht(args.product.originalPrice, args.lang)}</span>` : "";
  const discount = args.product.discountPercent && args.product.discountPercent > 0
    ? `<span class="badge-pill">-${Math.round(args.product.discountPercent * 100)}%</span>` : "";
  const ratingMeta = args.product.rating
    ? `<span><span class="star">★ ${args.product.rating.toFixed(1)}</span>${args.product.ratingCount ? ` (${abbreviateCount(args.product.ratingCount)})` : ""}</span>` : "";
  const soldMeta = args.product.soldCount
    ? `<span>${escapeHtml(i.sold)} ${abbreviateCount(args.product.soldCount)}</span>` : "";
  const sourceMeta = `<span>${escapeHtml(i.source)}: <strong>Shopee</strong></span>`;

  const brandRow = args.product.brand ? `<div class="detail-brand">${escapeHtml(args.product.brand)}</div>` : "";

  const specRows: string[] = [];
  if (args.product.brand) specRows.push(`<dt>${escapeHtml(i.brand)}</dt><dd>${escapeHtml(args.product.brand)}</dd>`);
  if (args.product.rating) specRows.push(`<dt>${escapeHtml(i.rating)}</dt><dd>★ ${args.product.rating.toFixed(1)}${args.product.ratingCount ? ` (${abbreviateCount(args.product.ratingCount)})` : ""}</dd>`);
  if (args.product.soldCount) specRows.push(`<dt>${escapeHtml(i.sold)}</dt><dd>${args.product.soldCount.toLocaleString()}</dd>`);
  specRows.push(`<dt>${escapeHtml(i.source)}</dt><dd>Shopee</dd>`);
  const specBlock = specRows.length > 0 ? `<div class="detail-spec"><dl>${specRows.join("")}</dl></div>` : "";

  const cta = args.product.affiliateShortUrl
    ? `<div class="detail-cta-wrap"><a href="${escapeHtml(args.product.affiliateShortUrl)}" class="detail-cta" rel="sponsored nofollow noopener" target="_blank">${escapeHtml(i.buyNow)}</a></div>`
    : "";

  return `${head}
<body>
${siteHeader(args.lang, path, alternates, args.config.name)}
<main>
  <article class="detail-wrap">
    <div class="detail-img">${img}</div>
    <div class="detail-info">
      ${brandRow}
      <h1>${escapeHtml(name)}</h1>
      <div class="detail-price-row">
        <span class="price">${formatBaht(args.product.currentPrice, args.lang)}</span>
        ${original}
        ${discount}
      </div>
      <div class="detail-meta">${ratingMeta}${soldMeta}${sourceMeta}</div>
      ${cta}
      ${specBlock}
      ${description ? `<div class="detail-desc">${escapeHtml(description)}</div>` : ""}
      <p class="disclosure-note">${escapeHtml(i.disclosure)}</p>
    </div>
  </article>
</main>
${siteFooter(args.lang, args.config)}
</body>
</html>`;
}

export function renderSitemap(args: {
  config: SiteConfig;
  productSlugs: string[];
}): string {
  const urls: string[] = [];
  for (const lang of LANGS) {
    urls.push(`https://${args.config.domain}${pageUrl(lang, "/")}`);
  }
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

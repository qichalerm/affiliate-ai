/**
 * Static-site HTML templates — Sprint 23: V1 theme port.
 *
 * V1 was built with Astro + Tailwind. We port the design exactly:
 *   - V1's compiled Tailwind CSS lives at src/web/static/theme.css
 *     (49KB, copied to dist/theme.css at build time so all pages share
 *      one cacheable stylesheet)
 *   - Templates here emit HTML using V1's Tailwind class structure
 *
 * Language strategy (per user instruction "แปลข้อความทั้งข้อมูลที่ดึงจาก
 * shopee มาก็แปลเลย"):
 *   - For lang === "th": always show Thai source (it IS the source)
 *   - For lang !== "th": ONLY show products that have a translation in
 *     that language. Products without translations are skipped from the
 *     grid for that language. No more silent Thai fallback on /en/, /zh/,
 *     /ja/ pages.
 *
 * V1 visuals: blue brand (#0c2d6b/#0b5fff), red deal accent (#dc2626),
 * gray ink scale, sticky header w/ blur, hero w/ search form, 4-col card
 * grid, category tiles, all dark-mode aware.
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
  niche: string | null;         // V2 Sprint 24 — for category pages + search filter
}

export interface SiteConfig {
  domain: string;
  name: string;
  lastUpdatedAt?: string;
  sources?: string[];
}

const I18N: Record<Lang, {
  htmlLang: string;
  ogLocale: string;
  liveBadge: string;
  heroLine1: string;
  heroLine2: string;
  heroSub1: string;
  heroSub2: string;
  searchPlaceholder: string;
  searchButton: string;
  popularLabel: string;
  popularChips: Array<{ q: string; label: string }>;
  hotDealsTitle: string;
  hotDealsSubtitle: string;
  reviewedTitle: string;
  reviewedSubtitle: string;
  categoriesTitle: string;
  categoriesSubtitle: string;
  ctaShopee: string;
  metaUpdated: string;
  metaSold: string;
  navHome: string;
  navDeals: string;
  navCategories: string;
  navAbout: string;
  langMenu: string;
  footerDisclosure: string;
  footerCopyright: string;
  productCount: string;
  loading: string;
  noProducts: string;
}> = {
  th: {
    htmlLang: "th-TH",
    ogLocale: "th_TH",
    liveBadge: "อัปเดตทุก 6 ชั่วโมง",
    heroLine1: "เช็คราคาก่อนช้อป",
    heroLine2: "ประหยัดได้ทุกครั้ง",
    heroSub1: "เปรียบเทียบราคา Shopee จากสินค้านับล้านรายการ",
    heroSub2: "อัปเดตอัตโนมัติ · ฟรี · ไม่ต้องสมัคร",
    searchPlaceholder: "ค้นหาสินค้า เช่น iPhone 16 Pro Max",
    searchButton: "ค้นหา",
    popularLabel: "ยอดฮิต:",
    popularChips: [
      { q: "หูฟัง", label: "หูฟัง" },
      { q: "พาวเวอร์แบงค์", label: "พาวเวอร์แบงค์" },
      { q: "เคสมือถือ", label: "เคสมือถือ" },
      { q: "หม้อทอด", label: "หม้อทอด" },
      { q: "ครีมกันแดด", label: "ครีมกันแดด" },
    ],
    hotDealsTitle: "🔥 ดีลร้อนวันนี้",
    hotDealsSubtitle: "ราคาตกหนักวันนี้ — ของจริง อัปเดตจาก Shopee",
    reviewedTitle: "⭐ สินค้ารีวิวเยอะ",
    reviewedSubtitle: "สินค้าขายดีและรีวิวเยอะที่สุด",
    categoriesTitle: "หมวดสินค้ายอดนิยม",
    categoriesSubtitle: "เลือกหมวดสินค้าที่คุณสนใจ",
    ctaShopee: "เช็คราคาที่ Shopee",
    metaUpdated: "อัปเดต",
    metaSold: "ขายแล้ว",
    navHome: "หน้าแรก",
    navDeals: "ดีลร้อน",
    navCategories: "หมวดสินค้า",
    navAbout: "เกี่ยวกับ",
    langMenu: "เปลี่ยนภาษา",
    footerDisclosure: "ลิงก์บนเว็บนี้เป็น affiliate links — เราอาจได้รับค่าคอมมิชชั่นเมื่อคุณซื้อผ่านลิงก์โดยไม่มีค่าใช้จ่ายเพิ่ม",
    footerCopyright: "© 2026 PriceTH · ราคาอ้างอิงจาก Shopee อาจมีการเปลี่ยนแปลง",
    productCount: "สินค้า",
    loading: "กำลังโหลด...",
    noProducts: "ยังไม่มีสินค้าในภาษานี้ — กำลังแปล...",
  },
  en: {
    htmlLang: "en",
    ogLocale: "en_US",
    liveBadge: "Updated every 6 hours",
    heroLine1: "Check prices before you shop.",
    heroLine2: "Save every time.",
    heroSub1: "Compare millions of products from Shopee Thailand",
    heroSub2: "Auto-updated · Free · No sign-up needed",
    searchPlaceholder: "Search products e.g. iPhone 16 Pro Max",
    searchButton: "Search",
    popularLabel: "Trending:",
    popularChips: [
      { q: "earphones", label: "Earphones" },
      { q: "power bank", label: "Power Bank" },
      { q: "phone case", label: "Phone Case" },
      { q: "air fryer", label: "Air Fryer" },
      { q: "sunscreen", label: "Sunscreen" },
    ],
    hotDealsTitle: "🔥 Hot Deals Today",
    hotDealsSubtitle: "Biggest price drops today — real deals from Shopee",
    reviewedTitle: "⭐ Most Reviewed",
    reviewedSubtitle: "Best-sellers with the most reviews",
    categoriesTitle: "Popular Categories",
    categoriesSubtitle: "Pick a category you're interested in",
    ctaShopee: "Check on Shopee",
    metaUpdated: "Updated",
    metaSold: "Sold",
    navHome: "Home",
    navDeals: "Deals",
    navCategories: "Categories",
    navAbout: "About",
    langMenu: "Change language",
    footerDisclosure: "Links on this site are affiliate links — we may earn a commission when you buy through them at no extra cost to you.",
    footerCopyright: "© 2026 PriceTH · Prices sourced from Shopee, subject to change",
    productCount: "products",
    loading: "Loading...",
    noProducts: "No products in this language yet — translating...",
  },
  zh: {
    htmlLang: "zh-CN",
    ogLocale: "zh_CN",
    liveBadge: "每 6 小时更新",
    heroLine1: "购物前查价",
    heroLine2: "次次省钱",
    heroSub1: "比较 Shopee 泰国百万商品价格",
    heroSub2: "自动更新 · 免费 · 无需注册",
    searchPlaceholder: "搜索商品，如 iPhone 16 Pro Max",
    searchButton: "搜索",
    popularLabel: "热门:",
    popularChips: [
      { q: "耳机", label: "耳机" },
      { q: "充电宝", label: "充电宝" },
      { q: "手机壳", label: "手机壳" },
      { q: "空气炸锅", label: "空气炸锅" },
      { q: "防晒霜", label: "防晒霜" },
    ],
    hotDealsTitle: "🔥 今日热门优惠",
    hotDealsSubtitle: "今日最大降价 — Shopee 真实优惠",
    reviewedTitle: "⭐ 评论最多",
    reviewedSubtitle: "评论最多的畅销商品",
    categoriesTitle: "热门分类",
    categoriesSubtitle: "选择您感兴趣的分类",
    ctaShopee: "在 Shopee 查看",
    metaUpdated: "更新",
    metaSold: "已售",
    navHome: "首页",
    navDeals: "优惠",
    navCategories: "分类",
    navAbout: "关于",
    langMenu: "切换语言",
    footerDisclosure: "本站链接为联盟链接 — 通过链接购买我们可能获得佣金，您无需支付额外费用。",
    footerCopyright: "© 2026 PriceTH · 价格来源 Shopee，可能变动",
    productCount: "件商品",
    loading: "加载中...",
    noProducts: "尚无该语言的商品 — 正在翻译...",
  },
  ja: {
    htmlLang: "ja",
    ogLocale: "ja_JP",
    liveBadge: "6 時間ごとに更新",
    heroLine1: "買う前に価格チェック",
    heroLine2: "毎回お得に",
    heroSub1: "Shopee タイの何百万もの商品の価格を比較",
    heroSub2: "自動更新 · 無料 · 登録不要",
    searchPlaceholder: "商品を検索 例: iPhone 16 Pro Max",
    searchButton: "検索",
    popularLabel: "人気:",
    popularChips: [
      { q: "イヤホン", label: "イヤホン" },
      { q: "モバイルバッテリー", label: "モバイルバッテリー" },
      { q: "スマホケース", label: "スマホケース" },
      { q: "エアフライヤー", label: "エアフライヤー" },
      { q: "日焼け止め", label: "日焼け止め" },
    ],
    hotDealsTitle: "🔥 今日のホットディール",
    hotDealsSubtitle: "今日の大幅値下げ — Shopee の本物のお得情報",
    reviewedTitle: "⭐ レビュー数が多い",
    reviewedSubtitle: "レビュー数が最も多いベストセラー",
    categoriesTitle: "人気カテゴリ",
    categoriesSubtitle: "興味のあるカテゴリを選択",
    ctaShopee: "Shopee で見る",
    metaUpdated: "更新",
    metaSold: "販売数",
    navHome: "ホーム",
    navDeals: "ディール",
    navCategories: "カテゴリ",
    navAbout: "サイトについて",
    langMenu: "言語を変更",
    footerDisclosure: "本サイトのリンクはアフィリエイトリンクです — 購入時に手数料を受け取る場合がありますが、追加料金は一切ありません。",
    footerCopyright: "© 2026 PriceTH · 価格は Shopee から、変動の可能性あり",
    productCount: "商品",
    loading: "読み込み中...",
    noProducts: "この言語の商品はまだありません — 翻訳中...",
  },
};

const CATEGORY_NICHES: Array<{
  slug: string;
  emoji: string;
  labels: Record<Lang, string>;
}> = [
  { slug: "it_gadget",      emoji: "💻", labels: { th: "IT & Gadget",         en: "IT & Gadget",       zh: "IT・数码",         ja: "IT・ガジェット" } },
  { slug: "beauty",         emoji: "💄", labels: { th: "ความงาม",             en: "Beauty",            zh: "美妆",            ja: "美容" } },
  { slug: "home_appliance", emoji: "🏠", labels: { th: "เครื่องใช้ในบ้าน",       en: "Home Appliances",   zh: "家电",            ja: "家電" } },
  { slug: "sports_fitness", emoji: "⚽", labels: { th: "กีฬาและฟิตเนส",         en: "Sports & Fitness",  zh: "运动健身",        ja: "スポーツ" } },
  { slug: "mom_baby",       emoji: "👶", labels: { th: "แม่และเด็ก",           en: "Mom & Baby",        zh: "母婴",            ja: "ママ・ベビー" } },
  { slug: "food_kitchen",   emoji: "🍳", labels: { th: "อาหารและครัว",         en: "Food & Kitchen",    zh: "食品厨房",        ja: "食品・キッチン" } },
  { slug: "fashion",        emoji: "👗", labels: { th: "แฟชั่น",              en: "Fashion",           zh: "时尚",            ja: "ファッション" } },
  { slug: "car_garage",     emoji: "🚗", labels: { th: "รถยนต์",              en: "Car & Garage",      zh: "汽车",            ja: "車・ガレージ" } },
];

export function categoryLabel(nicheSlug: string, lang: Lang): string {
  return CATEGORY_NICHES.find((c) => c.slug === nicheSlug)?.labels[lang] ?? nicheSlug;
}

export function knownNicheSlugs(): string[] {
  return CATEGORY_NICHES.map((c) => c.slug);
}

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
  return `/${lang}`;
}

function pageUrl(lang: Lang, path: string): string {
  return `${langPrefix(lang)}${path}`;
}

function productPath(lang: Lang, slug: string): string {
  return pageUrl(lang, `/p/${slug}`);
}

function abbreviateCount(n: number, lang: Lang): string {
  if (n < 1000) return n.toLocaleString(lang === "zh" ? "zh-CN" : lang === "ja" ? "ja" : "en");
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
}

/**
 * Get the localized name + description for a product. Returns null if
 * no translation exists for this lang (caller should skip the product).
 * Thai is always considered "translated" since it's the source.
 */
export function localizedProductOrNull(
  p: ProductForRender,
  lang: Lang,
): { name: string; description: string | null } | null {
  if (lang === "th") {
    return { name: p.name, description: p.description };
  }
  const t = p.translations?.[lang];
  if (!t?.name?.trim()) return null;  // skip — no translation yet
  return {
    name: t.name.trim(),
    description: t.description?.trim() ?? null,
  };
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
  siteName: string;
}): string {
  const i = I18N[args.lang];
  const fullCanonical = `https://${args.domain}${args.canonical}`;
  const ogImage = args.ogImage ?? `https://${args.domain}/og-image.png`;

  const alts = args.alternates
    .map((a) => `<link rel="alternate" hreflang="${I18N[a.lang].htmlLang}" href="https://${args.domain}${a.href}">`)
    .join("\n  ") +
    `\n  <link rel="alternate" hreflang="x-default" href="https://${args.domain}${pageUrl("en", "/")}">`;

  const ld = args.jsonLd ? `<script type="application/ld+json">${args.jsonLd}</script>` : "";

  return `<!DOCTYPE html>
<html lang="${i.htmlLang}" class="scroll-smooth">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#0b5fff">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(args.title)}</title>
  <meta name="description" content="${escapeHtml(args.description)}">
  <link rel="canonical" href="${fullCanonical}">
  ${alts}
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(args.siteName)}">
  <meta property="og:title" content="${escapeHtml(args.title)}">
  <meta property="og:description" content="${escapeHtml(args.description)}">
  <meta property="og:url" content="${fullCanonical}">
  <meta property="og:locale" content="${i.ogLocale}">
  <meta property="og:image" content="${escapeHtml(ogImage)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(args.title)}">
  <meta name="twitter:description" content="${escapeHtml(args.description)}">
  <meta name="twitter:image" content="${escapeHtml(ogImage)}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/favicon.svg">
  <link rel="mask-icon" href="/favicon.svg" color="#0b5fff">
  <link rel="preconnect" href="https://down-th.img.susercontent.com" crossorigin>
  <link rel="preconnect" href="https://cf.shopee.co.th" crossorigin>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap">
  <link rel="stylesheet" href="/theme.css">
  ${ld}
</head>`;
}

function logoMark(): string {
  return `<span class="relative grid h-9 w-9 place-items-center rounded-xl bg-brand-500 shadow-soft" aria-hidden="true">
    <svg viewBox="0 0 64 64" class="h-7 w-7" fill="none">
      <path d="M18 19h28" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="3.2" stroke-linecap="round"></path>
      <path d="M32 20v28" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"></path>
      <path d="M18 36l14 14 14-14" stroke="#FFFFFF" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <span class="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-deal-600 ring-2 ring-white dark:ring-ink-950"></span>
  </span>`;
}

function siteHeader(currentLang: Lang, currentPath: string, siteName: string): string {
  const i = I18N[currentLang];
  const langLinks = LANGS.map((l) => {
    const href = currentPath.replace(/^\/[a-z]{2}(\/|$)/, `/${l}$1`);
    const active = l === currentLang;
    return `<a href="${href}" class="block px-3 py-2 text-sm ${active ? "font-semibold text-brand-600" : "text-ink-700 dark:text-ink-200"} hover:bg-ink-50 dark:hover:bg-ink-800" hreflang="${I18N[l].htmlLang}">${l.toUpperCase()}</a>`;
  }).join("");

  const navLinks = `
    <a href="${pageUrl(currentLang, "/")}" class="hover:text-brand-600">${escapeHtml(i.navHome)}</a>
    <a href="${pageUrl(currentLang, "/#deals")}" class="hover:text-brand-600">${escapeHtml(i.navDeals)}</a>
    <a href="${pageUrl(currentLang, "/#categories")}" class="hover:text-brand-600">${escapeHtml(i.navCategories)}</a>
  `;

  return `<header class="sticky top-0 z-30 border-b border-ink-200/70 bg-white/85 backdrop-blur-lg dark:border-ink-800/70 dark:bg-ink-950/85">
  <div class="container-page flex h-16 items-center gap-3 sm:gap-6">
    <a href="${pageUrl(currentLang, "/")}" class="flex items-center gap-2 shrink-0" aria-label="${escapeHtml(siteName)} home">
      ${logoMark()}
      <span class="hidden sm:block text-lg font-bold tracking-tight text-ink-900 dark:text-ink-50">${escapeHtml(siteName)}</span>
    </a>
    <nav class="hidden lg:flex items-center gap-5 text-sm font-medium text-ink-700 dark:text-ink-300">
      ${navLinks}
    </nav>
    <div class="flex-1"></div>
    <details class="relative ml-auto sm:ml-0">
      <summary class="list-none flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 cursor-pointer hover:bg-ink-50 dark:border-ink-800 dark:bg-ink-900 dark:text-ink-200 dark:hover:bg-ink-800">
        <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm0 0v20M2 12h20" stroke="currentColor" stroke-width="1.7"/></svg>
        <span>${currentLang.toUpperCase()}</span>
      </summary>
      <div class="absolute right-0 mt-2 w-32 rounded-xl border border-ink-200 bg-white py-1 shadow-lift z-50 dark:border-ink-800 dark:bg-ink-900">
        ${langLinks}
      </div>
    </details>
  </div>
</header>`;
}

function siteFooter(lang: Lang, _config: SiteConfig): string {
  const i = I18N[lang];
  return `<footer class="border-t border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-950 mt-12">
  <div class="container-page py-10 flex flex-col gap-4 items-center text-center text-sm text-ink-600 dark:text-ink-400">
    <div class="flex items-center gap-2">
      ${logoMark()}
      <span class="text-base font-semibold text-ink-900 dark:text-ink-50">PriceTH</span>
    </div>
    <p class="max-w-2xl">${escapeHtml(i.footerDisclosure)}</p>
    <p class="text-xs text-ink-500">${escapeHtml(i.footerCopyright)}</p>
    <div class="flex gap-3 text-xs">
      <a href="${pageUrl(lang, "/")}" class="hover:text-brand-600">${escapeHtml(i.navHome)}</a>
      <span class="text-ink-300">·</span>
      <a href="${pageUrl(lang, "/#deals")}" class="hover:text-brand-600">${escapeHtml(i.navDeals)}</a>
      <span class="text-ink-300">·</span>
      <a href="${pageUrl(lang, "/#categories")}" class="hover:text-brand-600">${escapeHtml(i.navCategories)}</a>
    </div>
  </div>
</footer>`;
}

/* -----------------------------------------------------------------------------
 * Hero
 * ---------------------------------------------------------------------------*/

function heroSection(lang: Lang): string {
  const i = I18N[lang];
  const chipsHtml = i.popularChips.map((c) =>
    `<a href="${pageUrl(lang, `/search?q=${encodeURIComponent(c.q)}`)}" class="rounded-full border border-ink-200 bg-white px-3 py-1 text-ink-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition dark:border-ink-800 dark:bg-ink-900 dark:text-ink-300 dark:hover:bg-ink-800">${escapeHtml(c.label)}</a>`
  ).join("");

  return `<section class="hero-bg relative overflow-hidden">
  <div class="container-page py-12 sm:py-20 lg:py-28">
    <div class="mx-auto max-w-3xl text-center">
      <div class="mb-6 inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white/70 px-3 py-1 text-xs font-medium text-ink-700 backdrop-blur dark:border-ink-800 dark:bg-ink-900/70 dark:text-ink-300 animate-fade-in">
        <span class="pulse-dot"></span>
        <span>${escapeHtml(i.liveBadge)}</span>
      </div>
      <h1 class="text-display-md sm:text-display-lg text-balance text-ink-900 dark:text-ink-50 animate-slide-up">
        ${escapeHtml(i.heroLine1)}<br>
        <span class="text-brand-500">${escapeHtml(i.heroLine2)}</span>
      </h1>
      <p class="mt-5 text-lg text-ink-600 dark:text-ink-400 sm:text-xl text-balance animate-slide-up" style="animation-delay:.05s">
        ${escapeHtml(i.heroSub1)}<br class="hidden sm:block">
        <span class="text-ink-500 dark:text-ink-500 text-base sm:text-lg">${escapeHtml(i.heroSub2)}</span>
      </p>
      <form action="${pageUrl(lang, "/search")}" method="get" class="mt-8 mx-auto max-w-2xl animate-slide-up" style="animation-delay:.1s">
        <label class="relative block">
          <span class="absolute inset-y-0 left-0 flex items-center pl-5 text-ink-400">
            <svg viewBox="0 0 24 24" fill="none" class="h-6 w-6"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
          </span>
          <input type="search" name="q" required minlength="2" placeholder="${escapeHtml(i.searchPlaceholder)}" class="block w-full h-14 sm:h-16 rounded-2xl border border-ink-200 bg-white pl-14 pr-32 text-base sm:text-lg text-ink-900 placeholder:text-ink-400 shadow-soft focus:border-brand-500 focus:outline-none focus:shadow-ring dark:border-ink-800 dark:bg-ink-900 dark:text-ink-50">
          <button type="submit" class="absolute inset-y-2 right-2 inline-flex items-center justify-center rounded-xl bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 transition">
            <span>${escapeHtml(i.searchButton)}</span>
          </button>
        </label>
      </form>
      <div class="mt-6 flex items-center justify-center flex-wrap gap-2 text-sm animate-slide-up" style="animation-delay:.15s">
        <span class="text-ink-500 dark:text-ink-500">${escapeHtml(i.popularLabel)}</span>
        ${chipsHtml}
      </div>
    </div>
  </div>
</section>`;
}

/* -----------------------------------------------------------------------------
 * Product card (V1 structure)
 * ---------------------------------------------------------------------------*/

function productCard(p: ProductForRender, lang: Lang): string {
  const localized = localizedProductOrNull(p, lang);
  if (!localized) return "";  // skip products without translation
  const { name } = localized;
  const i = I18N[lang];

  const img = p.primaryImage ?? "";
  const discountPct = p.discountPercent && p.discountPercent > 0 ? Math.round(p.discountPercent * 100) : 0;
  const discountBadge = discountPct > 0
    ? `<span class="absolute left-2.5 top-2.5 rounded-md bg-deal-600 px-2 py-0.5 text-xs font-bold text-white shadow-soft">−${discountPct}%</span>`
    : "";
  const original = p.originalPrice && p.originalPrice > (p.currentPrice ?? 0)
    ? `<span class="text-sm text-ink-500 line-through">${formatBaht(p.originalPrice, lang)}</span>`
    : "";
  const ratingStars = p.rating
    ? `<div class="flex items-center gap-1.5">
        <svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 text-warn-500"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/></svg>
        <span class="font-medium text-ink-700 dark:text-ink-300">${p.rating.toFixed(1)}</span>
        ${p.ratingCount ? `<span class="text-ink-400">(${abbreviateCount(p.ratingCount, lang)})</span>` : ""}
      </div>`
    : "";
  const sold = p.soldCount
    ? `<span class="text-ink-500 dark:text-ink-400">${escapeHtml(i.metaSold)} ${abbreviateCount(p.soldCount, lang)}</span>`
    : "";

  const detailHref = productPath(lang, p.slug);

  return `<article class="card-interactive group relative flex flex-col overflow-hidden p-0">
  <a href="${detailHref}" class="flex flex-col h-full">
    <div class="relative aspect-square overflow-hidden bg-ink-100 dark:bg-ink-800">
      ${img
        ? `<img src="${escapeHtml(img)}" alt="${escapeHtml(name)}" loading="lazy" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]">`
        : `<div class="flex h-full items-center justify-center text-3xl text-ink-300">📦</div>`}
      ${discountBadge}
    </div>
    <div class="flex flex-1 flex-col p-3.5">
      <h3 class="line-clamp-2 min-h-[2.6rem] text-sm leading-tight font-medium text-ink-900 dark:text-ink-50">${escapeHtml(name)}</h3>
      <div class="mt-2 flex items-baseline gap-2 flex-wrap">
        <span class="text-xl font-bold text-ink-900 dark:text-ink-50">${formatBaht(p.currentPrice, lang)}</span>
        ${original}
      </div>
      <div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-500">
        ${ratingStars}
        ${sold}
      </div>
      <div class="mt-auto pt-3 flex items-center justify-between gap-2">
        <span></span>
        <span class="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 group-hover:text-brand-700 dark:text-brand-400">
          ${escapeHtml(i.ctaShopee)}
          <svg viewBox="0 0 24 24" fill="none" class="h-3.5 w-3.5 transition group-hover:translate-x-0.5"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </span>
      </div>
    </div>
  </a>
</article>`;
}

/* -----------------------------------------------------------------------------
 * Sections
 * ---------------------------------------------------------------------------*/

function productGridSection(args: {
  lang: Lang;
  id: string;
  title: string;
  subtitle: string;
  products: ProductForRender[];
}): string {
  const cards = args.products.map((p) => productCard(p, args.lang)).filter(Boolean).join("\n");
  const noContent = cards.trim() === ""
    ? `<p class="text-center text-ink-500 py-12">${escapeHtml(I18N[args.lang].noProducts)}</p>`
    : "";
  return `<section id="${args.id}" class="container-page pb-14 sm:pb-20">
  <div class="flex items-end justify-between mb-6 sm:mb-8">
    <div>
      <h2 class="section-title">${args.title}</h2>
      <p class="text-sm text-ink-500 dark:text-ink-400 mt-1">${escapeHtml(args.subtitle)}</p>
    </div>
  </div>
  ${noContent || `<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">${cards}</div>`}
</section>`;
}

function categoriesSection(lang: Lang): string {
  const i = I18N[lang];
  const tiles = CATEGORY_NICHES.map((c) => `
    <a href="${pageUrl(lang, `/c/${c.slug}`)}" class="card-interactive group flex flex-col items-center justify-center gap-2 p-4 sm:p-5">
      <div class="text-3xl sm:text-4xl group-hover:scale-110 transition">${c.emoji}</div>
      <h3 class="text-xs sm:text-sm font-semibold text-ink-900 dark:text-ink-50 text-center leading-tight">${escapeHtml(c.labels[lang])}</h3>
    </a>
  `).join("");

  return `<section id="categories" class="container-page pb-14 sm:pb-20">
  <div class="mb-6 sm:mb-8">
    <h2 class="section-title">${escapeHtml(i.categoriesTitle)}</h2>
    <p class="text-sm text-ink-500 dark:text-ink-400 mt-1">${escapeHtml(i.categoriesSubtitle)}</p>
  </div>
  <div class="grid grid-cols-3 gap-2.5 sm:gap-3 md:grid-cols-4 lg:grid-cols-8">${tiles}</div>
</section>`;
}

/* -----------------------------------------------------------------------------
 * Page renderers
 * ---------------------------------------------------------------------------*/

export function renderHomePage(args: {
  lang: Lang;
  products: ProductForRender[];
  config: SiteConfig;
}): string {
  const i = I18N[args.lang];
  const path = pageUrl(args.lang, "/");
  const alternates = LANGS.map((l) => ({ lang: l, href: pageUrl(l, "/") }));

  // Filter to translated-only when lang !== th (per user instruction)
  const visible = args.products.filter((p) => localizedProductOrNull(p, args.lang) !== null);

  // Hot deals = top 16 by discount_percent desc (then by score)
  const hotDeals = [...visible]
    .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))
    .slice(0, 16);

  // Most reviewed = top 16 by rating_count desc
  const reviewed = [...visible]
    .sort((a, b) => (b.ratingCount ?? 0) - (a.ratingCount ?? 0))
    .slice(0, 16);

  const head = htmlHead({
    lang: args.lang,
    title: `${args.config.name} — ${i.heroLine1} ${i.heroLine2}`,
    description: `${i.heroSub1} · ${i.heroSub2}`,
    canonical: path,
    ogImage: hotDeals[0]?.primaryImage ?? null,
    alternates,
    domain: args.config.domain,
    siteName: args.config.name,
  });

  return `${head}
<body class="min-h-screen flex flex-col">
${siteHeader(args.lang, path, args.config.name)}
<main class="flex-1 pb-20 sm:pb-0">
  ${heroSection(args.lang)}
  ${productGridSection({ lang: args.lang, id: "deals", title: i.hotDealsTitle, subtitle: i.hotDealsSubtitle, products: hotDeals })}
  ${categoriesSection(args.lang)}
  ${productGridSection({ lang: args.lang, id: "reviewed", title: i.reviewedTitle, subtitle: i.reviewedSubtitle, products: reviewed })}
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
  const localized = localizedProductOrNull(args.product, args.lang);
  // For lang !== th without translation: render Thai source as graceful fallback on detail
  // (better than 404 — visitor still sees product, search engines still see content)
  const { name, description } = localized ?? { name: args.product.name, description: args.product.description };

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
  });

  const head = htmlHead({
    lang: args.lang,
    title: `${name} — ${args.config.name}`,
    description: description?.slice(0, 160) ?? `${i.heroSub1} · ${i.heroSub2}`,
    canonical: path,
    ogImage: args.product.primaryImage,
    alternates,
    jsonLd,
    domain: args.config.domain,
    siteName: args.config.name,
  });

  const img = args.product.primaryImage
    ? `<img src="${escapeHtml(args.product.primaryImage)}" alt="${escapeHtml(name)}" class="h-full w-full object-cover" loading="eager">`
    : `<div class="flex h-full items-center justify-center text-6xl text-ink-300">📦</div>`;

  const discountPct = args.product.discountPercent && args.product.discountPercent > 0 ? Math.round(args.product.discountPercent * 100) : 0;
  const discountBadge = discountPct > 0
    ? `<span class="rounded-md bg-deal-600 px-2.5 py-1 text-sm font-bold text-white">−${discountPct}%</span>`
    : "";
  const original = args.product.originalPrice && args.product.originalPrice > (args.product.currentPrice ?? 0)
    ? `<span class="text-lg text-ink-500 line-through">${formatBaht(args.product.originalPrice, args.lang)}</span>` : "";

  const ratingMeta = args.product.rating
    ? `<div class="flex items-center gap-1.5"><svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4 text-warn-500"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/></svg><span class="font-medium text-ink-700 dark:text-ink-300">${args.product.rating.toFixed(1)}</span>${args.product.ratingCount ? `<span class="text-ink-400">(${abbreviateCount(args.product.ratingCount, args.lang)})</span>` : ""}</div>`
    : "";
  const soldMeta = args.product.soldCount
    ? `<span class="text-ink-500">${escapeHtml(i.metaSold)} ${abbreviateCount(args.product.soldCount, args.lang)}</span>`
    : "";

  const cta = args.product.affiliateShortUrl
    ? `<a href="${escapeHtml(args.product.affiliateShortUrl)}" rel="sponsored nofollow noopener" target="_blank" class="btn-primary-lg w-full sm:w-auto">${escapeHtml(i.ctaShopee)} <svg viewBox="0 0 24 24" fill="none" class="h-4 w-4 ml-2"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>`
    : "";

  return `${head}
<body class="min-h-screen flex flex-col">
${siteHeader(args.lang, path, args.config.name)}
<main class="flex-1 pb-20 sm:pb-0">
  <section class="container-page py-8 sm:py-12">
    <div class="grid lg:grid-cols-2 gap-8 lg:gap-12 items-start">
      <div class="aspect-square rounded-2xl overflow-hidden bg-ink-100 dark:bg-ink-800 lg:sticky lg:top-24">
        ${img}
      </div>
      <div>
        ${args.product.brand ? `<div class="text-xs uppercase tracking-wide text-ink-500 font-semibold mb-2">${escapeHtml(args.product.brand)}</div>` : ""}
        <h1 class="text-2xl sm:text-3xl font-bold text-ink-900 dark:text-ink-50 leading-tight mb-4">${escapeHtml(name)}</h1>
        <div class="flex items-baseline gap-3 flex-wrap mb-3">
          <span class="text-4xl font-bold text-ink-900 dark:text-ink-50">${formatBaht(args.product.currentPrice, args.lang)}</span>
          ${original}
          ${discountBadge}
        </div>
        <div class="flex gap-4 items-center text-sm mb-6">${ratingMeta}${soldMeta}</div>
        <div class="mb-6">${cta}</div>
        ${description ? `<div class="prose prose-sm dark:prose-invert max-w-none text-ink-700 dark:text-ink-300 mb-6">${escapeHtml(description)}</div>` : ""}
        <div class="text-xs text-ink-500 border-l-2 border-brand-300 pl-3 py-1">${escapeHtml(i.footerDisclosure)}</div>
      </div>
    </div>
  </section>
</main>
${siteFooter(args.lang, args.config)}
</body>
</html>`;
}

/* -----------------------------------------------------------------------------
 * Category page (/<lang>/c/<niche>) — filter products by niche
 * ---------------------------------------------------------------------------*/

export function renderCategoryPage(args: {
  lang: Lang;
  nicheSlug: string;
  products: ProductForRender[];   // already pre-filtered to this niche
  config: SiteConfig;
}): string {
  const i = I18N[args.lang];
  const path = pageUrl(args.lang, `/c/${args.nicheSlug}`);
  const alternates = LANGS.map((l) => ({ lang: l, href: pageUrl(l, `/c/${args.nicheSlug}`) }));
  const label = categoryLabel(args.nicheSlug, args.lang);
  const niche = CATEGORY_NICHES.find((c) => c.slug === args.nicheSlug);
  const emoji = niche?.emoji ?? "📦";

  const visible = args.products.filter((p) => localizedProductOrNull(p, args.lang) !== null);
  // Sort: discount % desc, then rating count desc
  visible.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0)
                       || (b.ratingCount ?? 0) - (a.ratingCount ?? 0));

  const head = htmlHead({
    lang: args.lang,
    title: `${emoji} ${label} — ${args.config.name}`,
    description: `${label} · ${i.heroSub1}`,
    canonical: path,
    ogImage: visible[0]?.primaryImage ?? null,
    alternates,
    domain: args.config.domain,
    siteName: args.config.name,
  });

  const cards = visible.map((p) => productCard(p, args.lang)).filter(Boolean).join("\n");
  const noContent = visible.length === 0
    ? `<p class="text-center text-ink-500 py-16">${escapeHtml(i.noProducts)}</p>`
    : "";

  return `${head}
<body class="min-h-screen flex flex-col">
${siteHeader(args.lang, path, args.config.name)}
<main class="flex-1 pb-20 sm:pb-0">
  <section class="container-page py-10 sm:py-14">
    <div class="mb-8">
      <a href="${pageUrl(args.lang, "/")}" class="text-sm text-ink-500 hover:text-brand-600">← ${escapeHtml(i.navHome)}</a>
      <h1 class="mt-3 text-3xl sm:text-4xl font-bold text-ink-900 dark:text-ink-50">
        <span class="text-3xl sm:text-4xl mr-2">${emoji}</span>${escapeHtml(label)}
      </h1>
      <p class="mt-2 text-ink-500">${visible.length} ${escapeHtml(i.productCount)}</p>
    </div>
    ${noContent || `<div class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">${cards}</div>`}
  </section>
</main>
${siteFooter(args.lang, args.config)}
</body>
</html>`;
}

/* -----------------------------------------------------------------------------
 * Search page (/<lang>/search) — client-side JS filter over the product index
 * Static page reads ?q= from URL, fetches /search-index-<lang>.json, filters,
 * renders cards. No server roundtrip.
 * ---------------------------------------------------------------------------*/

export function renderSearchPage(args: {
  lang: Lang;
  config: SiteConfig;
}): string {
  const i = I18N[args.lang];
  const path = pageUrl(args.lang, "/search");
  const alternates = LANGS.map((l) => ({ lang: l, href: pageUrl(l, "/search") }));

  const head = htmlHead({
    lang: args.lang,
    title: `${escapeHtml(i.searchPlaceholder)} — ${args.config.name}`,
    description: i.heroSub1,
    canonical: path,
    ogImage: null,
    alternates,
    domain: args.config.domain,
    siteName: args.config.name,
  });

  // Embed search runtime — minimal JS, ~1.5KB
  const script = `<script>
(function(){
  var lang = ${JSON.stringify(args.lang)};
  var i18n = ${JSON.stringify({
    placeholder: i.searchPlaceholder,
    button: i.searchButton,
    sold: i.metaSold,
    cta: i.ctaShopee,
    noResults: i.noProducts,
    resultsFor: args.lang === "th" ? "ผลการค้นหา" : args.lang === "zh" ? "搜索结果" : args.lang === "ja" ? "検索結果" : "Results for",
  })};
  var params = new URLSearchParams(location.search);
  var q = (params.get("q") || "").trim();
  var input = document.querySelector("input[name=q]");
  if (input && q) input.value = q;
  var grid = document.getElementById("results");
  var heading = document.getElementById("results-heading");
  if (!q) { grid.innerHTML = ""; return; }
  heading.textContent = i18n.resultsFor + ' "' + q + '"';
  fetch("/search-index-" + lang + ".json").then(function(r){ return r.json(); }).then(function(items){
    var ql = q.toLowerCase();
    var hits = items.filter(function(it){
      return (it.n || "").toLowerCase().indexOf(ql) !== -1
          || (it.b || "").toLowerCase().indexOf(ql) !== -1;
    }).slice(0, 60);
    if (hits.length === 0) {
      grid.innerHTML = '<p class="text-center text-ink-500 py-16 col-span-full">' + i18n.noResults + '</p>';
      return;
    }
    grid.innerHTML = hits.map(function(it){
      var pct = it.d ? Math.round(it.d * 100) : 0;
      var badge = pct > 0 ? '<span class="absolute left-2.5 top-2.5 rounded-md bg-deal-600 px-2 py-0.5 text-xs font-bold text-white shadow-soft">−' + pct + '%</span>' : '';
      var price = '฿' + Math.round(it.p / 100).toLocaleString();
      var oldP = it.op && it.op > it.p ? '<span class="text-sm text-ink-500 line-through">฿' + Math.round(it.op / 100).toLocaleString() + '</span>' : '';
      var rating = it.r ? '<div class="flex items-center gap-1.5"><svg viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 text-warn-500"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/></svg><span class="font-medium text-ink-700 dark:text-ink-300">' + it.r.toFixed(1) + '</span></div>' : '';
      var sold = it.s ? '<span class="text-ink-500">' + i18n.sold + ' ' + it.s + '</span>' : '';
      var img = it.i ? '<img src="' + it.i + '" alt="" loading="lazy" class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]">' : '<div class="flex h-full items-center justify-center text-3xl text-ink-300">📦</div>';
      return '<article class="card-interactive group relative flex flex-col overflow-hidden p-0">' +
        '<a href="/' + lang + '/p/' + it.u + '" class="flex flex-col h-full">' +
        '<div class="relative aspect-square overflow-hidden bg-ink-100 dark:bg-ink-800">' + img + badge + '</div>' +
        '<div class="flex flex-1 flex-col p-3.5">' +
        '<h3 class="line-clamp-2 min-h-[2.6rem] text-sm leading-tight font-medium text-ink-900 dark:text-ink-50">' + escapeText(it.n) + '</h3>' +
        '<div class="mt-2 flex items-baseline gap-2 flex-wrap"><span class="text-xl font-bold text-ink-900 dark:text-ink-50">' + price + '</span>' + oldP + '</div>' +
        '<div class="mt-2 flex items-center justify-between gap-2 text-[11px] text-ink-500">' + rating + sold + '</div>' +
        '</div></a></article>';
    }).join("");
  });
  function escapeText(s){ var d=document.createElement("div"); d.textContent=s; return d.innerHTML; }
})();
</script>`;

  return `${head}
<body class="min-h-screen flex flex-col">
${siteHeader(args.lang, path, args.config.name)}
<main class="flex-1 pb-20 sm:pb-0">
  <section class="container-page py-10 sm:py-14">
    <form action="${path}" method="get" class="mx-auto max-w-2xl">
      <label class="relative block">
        <span class="absolute inset-y-0 left-0 flex items-center pl-5 text-ink-400">
          <svg viewBox="0 0 24 24" fill="none" class="h-6 w-6"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"></circle><path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>
        </span>
        <input type="search" name="q" required minlength="2" placeholder="${escapeHtml(i.searchPlaceholder)}" autofocus class="block w-full h-14 sm:h-16 rounded-2xl border border-ink-200 bg-white pl-14 pr-32 text-base sm:text-lg text-ink-900 placeholder:text-ink-400 shadow-soft focus:border-brand-500 focus:outline-none focus:shadow-ring dark:border-ink-800 dark:bg-ink-900 dark:text-ink-50">
        <button type="submit" class="absolute inset-y-2 right-2 inline-flex items-center justify-center rounded-xl bg-brand-500 px-5 text-sm font-semibold text-white hover:bg-brand-600 transition">${escapeHtml(i.searchButton)}</button>
      </label>
    </form>
    <h2 id="results-heading" class="section-title mt-10 mb-6"></h2>
    <div id="results" class="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4"></div>
  </section>
</main>
${siteFooter(args.lang, args.config)}
${script}
</body>
</html>`;
}

/**
 * Build the search index for client-side fetch. Compact JSON keyed by short
 * field names to keep the file small (~30-50KB for 200 products):
 *   u: slug   n: name   b: brand   p: price-satang   op: original-price-satang
 *   d: discount   r: rating   s: sold   i: image-url
 */
export function buildSearchIndex(products: ProductForRender[], lang: Lang): string {
  const items = products
    .map((p) => {
      const localized = localizedProductOrNull(p, lang);
      if (!localized) return null;
      return {
        u: p.slug,
        n: localized.name,
        b: p.brand ?? "",
        p: p.currentPrice,
        op: p.originalPrice,
        d: p.discountPercent,
        r: p.rating,
        s: p.soldCount,
        i: p.primaryImage,
      };
    })
    .filter(Boolean);
  return JSON.stringify(items);
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

/* -----------------------------------------------------------------------------
 * Root index — language picker / redirect-first
 * ---------------------------------------------------------------------------*/

export function renderRootRedirect(domain: string): string {
  // Plain HTML that auto-redirects via meta + JS to the user's preferred lang.
  // Bots see the language picker. Per V1 pattern.
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PriceTH — Compare Shopee Thailand prices</title>
  <meta name="description" content="Compare Shopee Thailand prices with reviews and price history. Updated every 6 hours.">
  <link rel="canonical" href="https://${domain}/en/">
  <meta name="robots" content="noindex,follow">
  <script>
    (function(){
      var lang = (navigator.language || "en").slice(0,2).toLowerCase();
      var supported = ["th","en","zh","ja"];
      if (supported.indexOf(lang) === -1) lang = "en";
      try {
        var m = document.cookie.match(/(^| )lang=([^;]+)/);
        if (m && supported.indexOf(m[2]) !== -1) lang = m[2];
      } catch(_){}
      window.location.replace("/" + lang + "/");
    })();
  </script>
  <meta http-equiv="refresh" content="0; url=/en/">
  <style>body{font-family:system-ui;text-align:center;padding:64px 24px;color:#475569}</style>
</head>
<body>
  <p>Loading PriceTH…</p>
  <noscript>
    <p><a href="/en/">Continue to PriceTH (English) →</a></p>
    <p><a href="/th/">เข้าสู่ PriceTH (ภาษาไทย) →</a></p>
  </noscript>
</body>
</html>`;
}

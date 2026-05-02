/**
 * i18n helper for PriceTH — supports th, en, zh, ja.
 *
 * Country → language mapping (handled at edge by Cloudflare Worker;
 * keep in sync with workers/lang-redirect.ts):
 *   TH        → /th/
 *   CN/HK/MO  → /zh/
 *   JP        → /ja/
 *   *         → /en/  (fallback)
 *
 * Translations live in src/web/src/i18n/{lang}.json.
 */

import thDict from "../i18n/th.json";
import enDict from "../i18n/en.json";
import zhDict from "../i18n/zh.json";
import jaDict from "../i18n/ja.json";

export type Lang = "th" | "en" | "zh" | "ja";

export const SUPPORTED_LANGS: readonly Lang[] = ["th", "en", "zh", "ja"] as const;
export const DEFAULT_LANG: Lang = "en"; // fallback for unknown countries
export const PRIMARY_LANG: Lang = "th"; // home market

export const LANG_LABELS: Record<Lang, { name: string; flag: string }> = {
  th: { name: "ไทย", flag: "🇹🇭" },
  en: { name: "English", flag: "🇬🇧" },
  zh: { name: "中文", flag: "🇨🇳" },
  ja: { name: "日本語", flag: "🇯🇵" },
};

type Dict = typeof thDict;

const DICTS: Record<Lang, Dict> = {
  th: thDict,
  en: enDict,
  zh: zhDict as Dict,
  ja: jaDict as Dict,
};

export function getDict(lang: Lang): Dict {
  return DICTS[lang] ?? DICTS[DEFAULT_LANG];
}

/** Resolve language from a URL path (e.g. /th/ → "th"). Returns null for the root. */
export function langFromPath(pathname: string): Lang | null {
  const m = pathname.match(/^\/(th|en|zh|ja)(\/|$)/);
  return (m?.[1] as Lang) ?? null;
}

/** Format a localized internal URL: localePath("th", "/best") → "/th/best" */
export function localePath(lang: Lang, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (clean === "/") return `/${lang}/`;
  return `/${lang}${clean}`;
}

/** Lightweight string interpolation: t("ago: {time}", {time: "2h"}) */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

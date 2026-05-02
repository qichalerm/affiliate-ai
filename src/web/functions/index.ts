/**
 * Cloudflare Pages Function — root request handler.
 *
 * Detects user's preferred language from (in priority order):
 *   1. Saved cookie ("lang=...")
 *   2. CF-IPCountry header (geo via Cloudflare edge)
 *   3. Accept-Language header
 * Then 302-redirects to /{lang}/.
 *
 * Country → language map:
 *   TH               → /th/
 *   CN | HK | MO     → /zh/
 *   JP               → /ja/
 *   *                → /en/  (fallback for everyone else)
 *
 * Runs at the edge (close to the user) before any static asset is served.
 * Sets the cookie so subsequent visits skip detection.
 */

interface Env {}

const SUPPORTED = ["th", "en", "zh", "ja"] as const;
type Lang = (typeof SUPPORTED)[number];

function countryToLang(country: string): Lang {
  if (country === "TH") return "th";
  if (country === "CN" || country === "HK" || country === "MO") return "zh";
  if (country === "JP") return "ja";
  return "en";
}

function acceptLanguageToLang(header: string | null): Lang | null {
  if (!header) return null;
  // First language tag wins; e.g. "zh-CN,en;q=0.9" → "zh"
  const primary = header.split(",")[0]?.trim().toLowerCase() ?? "";
  if (primary.startsWith("th")) return "th";
  if (primary.startsWith("zh")) return "zh";
  if (primary.startsWith("ja")) return "ja";
  if (primary.startsWith("en")) return "en";
  return null;
}

function cookieToLang(cookieHeader: string | null): Lang | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/(?:^|;\s*)lang=([^;]+)/);
  const v = m?.[1];
  if (v && (SUPPORTED as readonly string[]).includes(v)) return v as Lang;
  return null;
}

// Country codes that have a strong, non-default language preference for our content
const STRONG_GEO: Record<string, Lang> = {
  TH: "th",
  CN: "zh",
  HK: "zh",
  MO: "zh",
  JP: "ja",
};

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  // 1. Saved choice always wins (manual switch in language menu)
  const fromCookie = cookieToLang(request.headers.get("cookie"));

  // 2. Geo → language (only for countries with a strong language match)
  // @ts-expect-error - cf is available at runtime on Cloudflare
  const country: string = (request.cf?.country as string) || "";
  const fromGeo = STRONG_GEO[country];

  // 3. Accept-Language as fallback (browser pref) — used when geo is "unknown" or maps to default
  const fromAccept = acceptLanguageToLang(request.headers.get("accept-language"));

  const lang: Lang = fromCookie ?? fromGeo ?? fromAccept ?? "en";

  const url = new URL(request.url);
  const target = `${url.origin}/${lang}/`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: target,
      "Set-Cookie": `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
      "Cache-Control": "no-store",
      Vary: "Cookie, Accept-Language, CF-IPCountry",
    },
  });
};

/**
 * User-Agent rotation pool.
 *
 * Strategy:
 *  - Use real, current Chrome/Edge/Safari UAs (not legacy / bot fingerprints)
 *  - Weight desktop heavier than mobile (Shopee dashboard is desktop-first)
 *  - Pin a UA per "session" (consistent within a scraping run) to avoid
 *    looking like a single client switching browsers mid-session
 */

interface UserAgentEntry {
  ua: string;
  weight: number;
  platform: "desktop" | "mobile";
  acceptLanguage: string;
  secChUa?: string;
  secChUaPlatform?: string;
  secChUaMobile?: string;
}

// Real UAs collected from browserstack/StatCounter top 20 in TH (2026)
const POOL: UserAgentEntry[] = [
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    weight: 30,
    platform: "desktop",
    acceptLanguage: "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    weight: 18,
    platform: "desktop",
    acceptLanguage: "th-TH,th;q=0.9,en;q=0.8",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"macOS"',
    secChUaMobile: "?0",
  },
  {
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.142",
    weight: 12,
    platform: "desktop",
    acceptLanguage: "th-TH,th;q=0.9,en;q=0.8",
    secChUa: '"Microsoft Edge";v="130", "Chromium";v="130", "Not_A Brand";v="24"',
    secChUaPlatform: '"Windows"',
    secChUaMobile: "?0",
  },
  {
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    weight: 8,
    platform: "desktop",
    acceptLanguage: "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
  },
  {
    ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
    weight: 18,
    platform: "mobile",
    acceptLanguage: "th-TH,th;q=0.9,en;q=0.8",
  },
  {
    ua: "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    weight: 14,
    platform: "mobile",
    acceptLanguage: "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
    secChUa: '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    secChUaPlatform: '"Android"',
    secChUaMobile: "?1",
  },
];

const TOTAL_WEIGHT = POOL.reduce((s, e) => s + e.weight, 0);

export interface SessionFingerprint {
  ua: string;
  acceptLanguage: string;
  secChUa?: string;
  secChUaPlatform?: string;
  secChUaMobile?: string;
  platform: "desktop" | "mobile";
}

/**
 * Pick a weighted-random UA. Use this when starting a new session.
 */
export function pickFingerprint(opts: { preferDesktop?: boolean } = {}): SessionFingerprint {
  let pool = POOL;
  if (opts.preferDesktop) pool = POOL.filter((e) => e.platform === "desktop");
  const total = pool.reduce((s, e) => s + e.weight, 0);

  let r = Math.random() * total;
  for (const entry of pool) {
    r -= entry.weight;
    if (r <= 0) {
      return {
        ua: entry.ua,
        acceptLanguage: entry.acceptLanguage,
        secChUa: entry.secChUa,
        secChUaPlatform: entry.secChUaPlatform,
        secChUaMobile: entry.secChUaMobile,
        platform: entry.platform,
      };
    }
  }
  // fallback (shouldn't reach)
  const e = pool[0]!;
  return {
    ua: e.ua,
    acceptLanguage: e.acceptLanguage,
    platform: e.platform,
  };
}

/**
 * Map fingerprint → realistic header set (Chrome-style).
 */
export function fingerprintToHeaders(
  fp: SessionFingerprint,
  referer?: string,
): Record<string, string> {
  const h: Record<string, string> = {
    "User-Agent": fp.ua,
    Accept: "application/json, text/plain, */*",
    "Accept-Language": fp.acceptLanguage,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
  };
  if (fp.secChUa) h["sec-ch-ua"] = fp.secChUa;
  if (fp.secChUaMobile) h["sec-ch-ua-mobile"] = fp.secChUaMobile;
  if (fp.secChUaPlatform) h["sec-ch-ua-platform"] = fp.secChUaPlatform;
  if (referer) {
    h["Referer"] = referer;
    h["Sec-Fetch-Site"] = "same-origin";
    h["Sec-Fetch-Mode"] = "cors";
    h["Sec-Fetch-Dest"] = "empty";
  }
  return h;
}

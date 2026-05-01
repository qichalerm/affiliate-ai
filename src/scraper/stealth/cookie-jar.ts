/**
 * Cookie jar — persists cookies per session.
 *
 * Why: Real browsers warm up by visiting the homepage first, which sets
 * tracking cookies (CSRF, session, AB-test buckets). Hitting the API
 * cold (no cookies) is a strong bot tell.
 *
 * Strategy:
 *  - Per-session cookie storage (in-memory; resets per scrape run)
 *  - Warm up: visit homepage → store cookies → use on subsequent requests
 *  - Cookies expire with session
 */

import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";

const log = child("cookie-jar");

interface CookieJar {
  cookies: Map<string, string>;
  lastWarmupAt: number;
  domain: string;
}

const jars = new Map<string, CookieJar>();

export function getJar(sessionId: string, domain: string): CookieJar {
  let jar = jars.get(sessionId);
  if (!jar) {
    jar = { cookies: new Map(), lastWarmupAt: 0, domain };
    jars.set(sessionId, jar);
  }
  return jar;
}

export function clearJar(sessionId: string): void {
  jars.delete(sessionId);
}

/** Parse Set-Cookie response headers into the jar. */
export function ingestSetCookie(jar: CookieJar, response: Response): void {
  // Bun/undici only exposes the first Set-Cookie via .get(); use raw headers
  // Note: We use response.headers.getSetCookie() if available, else fallback
  // biome-ignore lint/suspicious/noExplicitAny: getSetCookie is available on undici Headers
  const headers = response.headers as any;
  const cookies: string[] =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : response.headers.get("set-cookie")
        ? [response.headers.get("set-cookie")!]
        : [];

  for (const setCookie of cookies) {
    const [pair] = setCookie.split(";");
    const [name, ...rest] = (pair ?? "").split("=");
    if (!name || rest.length === 0) continue;
    jar.cookies.set(name.trim(), rest.join("=").trim());
  }
}

/** Build Cookie header from jar. */
export function buildCookieHeader(jar: CookieJar): string {
  return Array.from(jar.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/**
 * Warm up the session by visiting the homepage.
 * Call once per session before any API requests.
 *
 * Returns true if warmup succeeded; false otherwise (still safe to proceed).
 */
export async function warmUp(
  sessionId: string,
  homepageUrl: string,
  headers: Record<string, string>,
  proxy?: string,
): Promise<boolean> {
  const url = new URL(homepageUrl);
  const jar = getJar(sessionId, url.host);

  // Don't re-warm within 30 minutes
  if (Date.now() - jar.lastWarmupAt < 30 * 60_000 && jar.cookies.size > 0) {
    return true;
  }

  try {
    const fetchInit: RequestInit & { proxy?: string } = {
      headers: {
        ...headers,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "th-TH,th;q=0.9,en;q=0.8",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      // Don't follow redirects manually — let fetch handle it
      redirect: "follow",
    };
    if (proxy) fetchInit.proxy = proxy;

    const res = await fetch(homepageUrl, fetchInit);
    ingestSetCookie(jar, res);
    // Drain body to finalize the request
    await res.arrayBuffer();

    jar.lastWarmupAt = Date.now();
    log.debug(
      { sessionId, cookies: jar.cookies.size, status: res.status },
      "session warmed up",
    );
    return res.ok;
  } catch (err) {
    log.warn({ sessionId, err: errMsg(err) }, "warmup failed; proceeding without cookies");
    return false;
  }
}

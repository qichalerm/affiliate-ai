/**
 * Google Search Console daily ingestion.
 *
 * Pulls keyword + page performance data via Search Analytics API, aggregates
 * by (page, keyword, day) and persists to keyword_performance table.
 *
 * Setup:
 *   1. Same service account JSON as Indexing API (src/seo/google-indexing.ts)
 *   2. Add account email as Owner in Google Search Console
 *   3. Set GOOGLE_SEARCH_CONSOLE_PROPERTY in .env (e.g. https://yourdomain.com/)
 *
 * Quota: 1200 queries/day (we use ~1 per ingestion run = plenty)
 */

import { db, schema } from "../../lib/db.ts";
import { sql } from "drizzle-orm";
import { env, can } from "../../lib/env.ts";
import { child } from "../../lib/logger.ts";
import { errMsg } from "../../lib/retry.ts";
import { readFile } from "node:fs/promises";
import { sign } from "node:crypto";

const log = child("analytics.gsc");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GSC_API = "https://searchconsole.googleapis.com/webmasters/v3";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedAccount: ServiceAccount | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  if (cachedAccount) return cachedAccount;
  try {
    const raw = await readFile(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH, "utf8");
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    cachedAccount = sa;
    return sa;
  } catch {
    return null;
  }
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.token;
  }
  const sa = await loadServiceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claim))}`;
  const signature = sign("RSA-SHA256", Buffer.from(unsigned), sa.private_key);
  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return data.access_token;
}

interface SearchAnalyticsRow {
  keys: string[]; // [page, query, country, device]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
}

export async function ingestSearchConsole(opts: { days?: number } = {}): Promise<{
  ingested: number;
  skipped: number;
  daysQueried: number;
}> {
  if (!env.GOOGLE_SEARCH_CONSOLE_PROPERTY) {
    log.info("GSC_PROPERTY not set; skip");
    return { ingested: 0, skipped: 0, daysQueried: 0 };
  }
  const token = await getAccessToken();
  if (!token) {
    log.info("GSC service account not available; skip");
    return { ingested: 0, skipped: 0, daysQueried: 0 };
  }

  const days = opts.days ?? 3;
  const today = new Date();
  // Search Console data has ~2-day delay
  const endDate = isoDate(addDays(today, -2));
  const startDate = isoDate(addDays(today, -days - 2));

  log.info({ startDate, endDate }, "GSC ingest start");

  const propEncoded = encodeURIComponent(env.GSC_API_PROPERTY ?? env.GOOGLE_SEARCH_CONSOLE_PROPERTY);
  const url = `${GSC_API}/sites/${propEncoded}/searchAnalytics/query`;

  let ingested = 0;
  let skipped = 0;
  let daysQueried = 0;

  // Daily queries (gives us date-level granularity)
  for (let d = 0; d < days; d++) {
    const date = isoDate(addDays(today, -d - 2));
    daysQueried++;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: date,
          endDate: date,
          dimensions: ["page", "query", "country", "device"],
          rowLimit: 5000,
        }),
      });
      if (!res.ok) {
        log.warn({ date, status: res.status }, "GSC query failed");
        continue;
      }
      const data = (await res.json()) as SearchAnalyticsResponse;
      const rows = data.rows ?? [];

      const inserts = await Promise.all(
        rows.map((row) => mapRowToInsert(row, new Date(date))),
      );
      const valid = inserts.filter((r): r is NonNullable<typeof r> => r !== null);

      if (valid.length > 0) {
        // Insert in chunks
        for (let i = 0; i < valid.length; i += 100) {
          const chunk = valid.slice(i, i + 100);
          try {
            await db.insert(schema.keywordPerformance).values(chunk).onConflictDoUpdate({
              target: [
                schema.keywordPerformance.contentPageId,
                schema.keywordPerformance.keyword,
                schema.keywordPerformance.capturedDate,
                schema.keywordPerformance.country,
                schema.keywordPerformance.device,
              ],
              set: {
                impressions: sql`EXCLUDED.impressions`,
                clicks: sql`EXCLUDED.clicks`,
                avgPosition: sql`EXCLUDED.avg_position`,
                ctr: sql`EXCLUDED.ctr`,
              },
            });
            ingested += chunk.length;
          } catch (err) {
            skipped += chunk.length;
            log.warn({ err: errMsg(err) }, "kw insert chunk failed");
          }
        }
      }
    } catch (err) {
      log.warn({ date, err: errMsg(err) }, "GSC day failed");
    }
  }

  log.info({ ingested, skipped, daysQueried }, "GSC ingest done");
  return { ingested, skipped, daysQueried };
}

async function mapRowToInsert(
  row: SearchAnalyticsRow,
  date: Date,
): Promise<typeof schema.keywordPerformance.$inferInsert | null> {
  const [pageUrl, query, country, device] = row.keys;
  if (!pageUrl || !query) return null;

  // Parse the page URL to find the slug → resolve content_page_id
  const slug = extractSlugFromUrl(pageUrl);
  if (!slug) return null;

  const page = await db.query.contentPages.findFirst({
    where: (cp, { eq }) => eq(cp.slug, slug),
    columns: { id: true },
  });
  if (!page) return null;

  return {
    contentPageId: page.id,
    keyword: query.slice(0, 256),
    impressions: row.impressions,
    clicks: row.clicks,
    avgPosition: row.position,
    ctr: row.ctr,
    country: country?.toUpperCase().slice(0, 4) ?? null,
    device: device?.toLowerCase().slice(0, 16) ?? null,
    capturedDate: date,
  };
}

function extractSlugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const segments = decodeURIComponent(u.pathname).split("/").filter(Boolean);
    return segments[segments.length - 1] ?? null;
  } catch {
    return null;
  }
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

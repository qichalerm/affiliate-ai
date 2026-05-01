/**
 * Google Indexing API — fast-track URL indexing.
 *
 * Note: Google's Indexing API is officially for JobPosting + BroadcastEvent only,
 * but in practice it works for any URL. Use sparingly to avoid quota throttling.
 *
 * Quota: 200 requests/day default; can request increase.
 *
 * Setup:
 *   1. Create Google Cloud project
 *   2. Enable Indexing API
 *   3. Create service account, download JSON
 *   4. Verify the service account email in Search Console (as Owner)
 *   5. Set GOOGLE_SERVICE_ACCOUNT_JSON_PATH
 */

import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg } from "../lib/retry.ts";
import { readFile } from "node:fs/promises";
import { sign } from "node:crypto";

const log = child("google-indexing");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const INDEXING_URL = "https://indexing.googleapis.com/v3/urlNotifications:publish";

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

let cachedAccount: ServiceAccount | null = null;
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  if (cachedAccount) return cachedAccount;
  try {
    const raw = await readFile(env.GOOGLE_SERVICE_ACCOUNT_JSON_PATH, "utf8");
    const sa = JSON.parse(raw) as ServiceAccount;
    if (!sa.client_email || !sa.private_key) return null;
    cachedAccount = sa;
    return sa;
  } catch (err) {
    log.debug({ err: errMsg(err) }, "google service account not available");
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
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }
  const sa = await loadServiceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
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
  if (!res.ok) {
    log.warn({ status: res.status }, "google token failed");
    return null;
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function notifyGoogleIndex(
  url: string,
  type: "URL_UPDATED" | "URL_DELETED" = "URL_UPDATED",
): Promise<boolean> {
  const token = await getAccessToken();
  if (!token) return false;

  try {
    const res = await fetch(INDEXING_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, type }),
    });
    if (!res.ok) {
      log.warn({ url, status: res.status }, "google indexing notify failed");
      return false;
    }
    return true;
  } catch (err) {
    log.warn({ url, err: errMsg(err) }, "google indexing error");
    return false;
  }
}

/** Submit a batch of URLs (with rate limiting to respect 200/day quota). */
export async function batchNotifyGoogle(urls: string[]): Promise<{
  submitted: number;
  failed: number;
}> {
  let submitted = 0;
  let failed = 0;
  // Cap at 100/run to leave headroom in daily quota
  const slice = urls.slice(0, 100);
  for (const url of slice) {
    const ok = await notifyGoogleIndex(url);
    if (ok) submitted++;
    else failed++;
    // Sleep briefly to avoid bursting quota
    await new Promise((r) => setTimeout(r, 200));
  }
  log.info({ submitted, failed, total: urls.length }, "google indexing batch done");
  return { submitted, failed };
}

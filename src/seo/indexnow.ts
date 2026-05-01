/**
 * Bing IndexNow + Yandex IndexNow submission.
 *
 * Submits URLs for fast indexing (typically minutes vs days).
 * Both Bing and Yandex use the same IndexNow protocol.
 *
 * Setup:
 *   1. Generate a key at bing.com/indexnow
 *   2. Set BING_INDEXNOW_KEY in .env
 *   3. Place {key}.txt at site root containing the key (Astro public/)
 */

import { env } from "../lib/env.ts";
import { child } from "../lib/logger.ts";
import { errMsg, retry } from "../lib/retry.ts";
import { writeFile } from "node:fs/promises";
import * as path from "node:path";

const log = child("indexnow");

const ENDPOINTS = ["https://www.bing.com/indexnow", "https://yandex.com/indexnow"];

const SITE = `https://${env.DOMAIN_NAME}`;

export async function submitToIndexNow(urls: string[]): Promise<{
  submitted: number;
  failed: number;
}> {
  if (!env.BING_INDEXNOW_KEY) {
    log.info("BING_INDEXNOW_KEY not set; skipping");
    return { submitted: 0, failed: 0 };
  }
  if (urls.length === 0) return { submitted: 0, failed: 0 };

  // IndexNow accepts up to 10,000 URLs per request
  const CHUNK = 10_000;
  let submitted = 0;
  let failed = 0;

  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    const body = {
      host: env.DOMAIN_NAME,
      key: env.BING_INDEXNOW_KEY,
      keyLocation: `${SITE}/${env.BING_INDEXNOW_KEY}.txt`,
      urlList: chunk,
    };

    for (const endpoint of ENDPOINTS) {
      try {
        await retry(
          async () => {
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (!res.ok && res.status !== 202) {
              throw new Error(`indexnow ${res.status}: ${await res.text().catch(() => "")}`);
            }
          },
          { attempts: 2, baseDelayMs: 1000 },
        );
        submitted += chunk.length;
        log.debug({ endpoint, count: chunk.length }, "indexnow submitted");
      } catch (err) {
        failed += chunk.length;
        log.warn({ endpoint, err: errMsg(err) }, "indexnow submit failed");
      }
    }
  }

  // De-dupe count (we hit 2 endpoints with same urls)
  return { submitted: Math.min(submitted, urls.length * ENDPOINTS.length), failed };
}

/**
 * Write the verification file to public/ — needed by IndexNow protocol.
 * Run this once during build.
 */
export async function writeIndexNowKeyFile(outputDir: string): Promise<void> {
  if (!env.BING_INDEXNOW_KEY) return;
  const keyFile = path.join(outputDir, `${env.BING_INDEXNOW_KEY}.txt`);
  await writeFile(keyFile, env.BING_INDEXNOW_KEY, "utf8");
  log.debug({ file: keyFile }, "indexnow key file written");
}
